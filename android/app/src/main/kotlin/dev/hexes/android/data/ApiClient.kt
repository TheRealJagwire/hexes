package dev.hexes.android.data

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** The API contract version this app was written against (the server's `X-Hexes-Api`). */
const val SUPPORTED_API_VERSION = 1

sealed class ApiException(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** The server could not be reached at all. */
    class Unreachable(cause: Throwable) : ApiException(cause.message ?: "Could not reach the server", cause)

    /** 401: missing or wrong token. */
    class Unauthorized(message: String) : ApiException(message)

    /** The server answered with an error status; `message` is the server's own text when it sent one. */
    class Http(val status: Int, message: String) : ApiException(message)

    /** The server speaks a different API version than this app. */
    class VersionMismatch(val server: Int?) : ApiException(
        "This server uses API version ${server ?: "unknown"}, but the app expects $SUPPORTED_API_VERSION. " +
            "Update the app or Studio.",
    )

    /** The response was not the JSON the app expects. */
    class BadResponse(cause: Throwable) : ApiException("Unexpected response from the server", cause)
}

val apiJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(8, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .build()

/** Talks to one Studio server. Read endpoints for now; writes arrive with the editing screens. */
class ApiClient(
    private val connection: Connection,
    private val http: OkHttpClient = defaultHttpClient(),
) {
    /** Reaches the server, checks the token and the API version. Returns the version it saw. */
    suspend fun health(): Int {
        val response = execute(request("/api/health"))
        response.use {
            checkStatus(it)
            val version = it.header("X-Hexes-Api")?.toIntOrNull()
            if (version != SUPPORTED_API_VERSION) throw ApiException.VersionMismatch(version)
            return version
        }
    }

    suspend fun state(): WorkspaceState = get("/api/state", WorkspaceState.serializer())

    suspend fun projects(): List<ProjectSummary> =
        get("/api/projects", ListSerializer(ProjectSummary.serializer()))

    suspend fun recentWorkspaces(): List<RecentWorkspace> =
        get("/api/workspace/recent", ListSerializer(RecentWorkspace.serializer()))

    private suspend fun <T> get(path: String, serializer: DeserializationStrategy<T>): T {
        val response = execute(request(path))
        response.use {
            checkStatus(it)
            val body = it.body.string()
            try {
                return apiJson.decodeFromString(serializer, body)
            } catch (e: Exception) {
                throw ApiException.BadResponse(e)
            }
        }
    }

    private fun request(path: String): Request {
        val url = connection.baseUrl.newBuilder().encodedPath(path).build()
        val builder = Request.Builder().url(url).header("Accept", "application/json")
        if (connection.token.isNotEmpty()) builder.header("Authorization", "Bearer ${connection.token}")
        return builder.build()
    }

    private fun checkStatus(response: Response) {
        if (response.isSuccessful) return
        val text = runCatching { apiJson.decodeFromString(ApiError.serializer(), response.peekBody(64 * 1024).string()).error }
            .getOrNull()
        when (response.code) {
            401 -> throw ApiException.Unauthorized(text ?: "The server rejected the token")
            else -> throw ApiException.Http(response.code, text ?: "Request failed (${response.code})")
        }
    }

    private suspend fun execute(request: Request): Response =
        suspendCancellableCoroutine { continuation ->
            val call = http.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    continuation.resumeWithException(ApiException.Unreachable(e))
                }

                override fun onResponse(call: Call, response: Response) {
                    continuation.resume(response)
                }
            })
        }
}
