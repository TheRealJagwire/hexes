package dev.hexes.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** The API contract version this app was written against (the server's `X-Hexes-Api`). */
const val SUPPORTED_API_VERSION = 1

sealed class ApiException(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** The server could not be reached at all. */
    class Unreachable(cause: Throwable, val address: String? = null) : ApiException(
        "Can't reach Studio" + (address?.let { " at $it" } ?: "") + ". Is it running, and is the address right?",
        cause,
    )

    /** 401: missing or wrong token. */
    class Unauthorized(message: String) : ApiException(message)

    /** The server answered with an error status; `message` is the server's own text when it sent one. */
    class Http(val status: Int, message: String) : ApiException(message)

    /** The server speaks a different API version than this app. */
    class VersionMismatch(val server: Int?) : ApiException(
        "This server uses API version ${server ?: "unknown"}, but the app expects $SUPPORTED_API_VERSION. " +
            "Update the app or Studio.",
    )

    /** No server address has been saved yet. */
    class NotConfigured : ApiException("No server is set up yet. Open Settings to connect.")

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

private val JSON = "application/json".toMediaType()

/** Talks to one Studio server. Read endpoints for now; writes arrive with the editing screens. */
class ApiClient(
    private val connection: Connection,
    private val http: OkHttpClient = defaultHttpClient(),
) {
    /** Reaches the server, checks the token and the API version. Returns the version it saw. */
    suspend fun health(): Int {
        val response = execute(request("/api/health"))
        // The coroutine resumes on the caller's dispatcher (often Main); reading or closing a body is I/O.
        return withContext(Dispatchers.IO) {
            response.use {
                checkStatus(it)
                val version = it.header("X-Hexes-Api")?.toIntOrNull()
                if (version != SUPPORTED_API_VERSION) throw ApiException.VersionMismatch(version)
                version
            }
        }
    }

    suspend fun state(): WorkspaceState = get("/api/state", WorkspaceState.serializer())

    /** The per-kind status table; [StatusTable.LEGACY] for a Studio too old to serve it. */
    suspend fun statuses(): StatusTable =
        try {
            get("/api/statuses", StatusTable.serializer())
        } catch (e: ApiException.Http) {
            if (e.status == 404) StatusTable.LEGACY else throw e
        }

    suspend fun projects(): List<ProjectSummary> =
        get("/api/projects", ListSerializer(ProjectSummary.serializer()))

    suspend fun recentWorkspaces(): List<RecentWorkspace> =
        get("/api/workspace/recent", ListSerializer(RecentWorkspace.serializer()))

    suspend fun project(id: String): ProjectView =
        get("/api/projects/${encode(id)}", ProjectView.serializer())

    suspend fun hex(id: String): HexView = get("/api/hexes/${encode(id)}", HexView.serializer())

    suspend fun selectProject(id: String) {
        send("POST", "/api/selected-project", apiJson.encodeToString(SelectProjectRequest.serializer(), SelectProjectRequest(id)))
    }

    suspend fun openWorkspace(dir: String): WorkspaceState {
        val body = apiJson.encodeToString(DirRequest.serializer(), DirRequest(dir))
        return decode(send("POST", "/api/workspace/open", body), WorkspaceState.serializer())
    }

    suspend fun updateHex(id: String, patch: UpdateHexRequest): Hex {
        val body = apiJson.encodeToString(UpdateHexRequest.serializer(), patch)
        return decode(send("PATCH", "/api/hexes/${encode(id)}", body), Hex.serializer())
    }

    /** Sets a meta key, adding it or replacing its value. */
    suspend fun setMeta(id: String, key: String, value: String): Hex {
        val body = apiJson.encodeToString(MetaValueRequest.serializer(), MetaValueRequest(value))
        return decode(send("PUT", "/api/hexes/${encode(id)}/meta/${encode(key)}", body), Hex.serializer())
    }

    suspend fun removeMeta(id: String, key: String): Hex =
        decode(send("DELETE", "/api/hexes/${encode(id)}/meta/${encode(key)}", null), Hex.serializer())

    /** Deletes a hex (a whole project when it is one). Returns every id that was removed. */
    suspend fun deleteHex(id: String): List<String> =
        decode(send("DELETE", "/api/hexes/${encode(id)}", null), DeleteResult.serializer()).deleted

    /** Puts a work hex on its own branch, switching Studio's working tree to it. */
    suspend fun startWork(id: String): Hex =
        decode(send("POST", "/api/hexes/${encode(id)}/branch", "{}"), Hex.serializer())

    suspend fun openPullRequest(id: String, req: OpenPullRequestRequest = OpenPullRequestRequest()): Hex {
        val body = apiJson.encodeToString(OpenPullRequestRequest.serializer(), req)
        return decode(send("POST", "/api/hexes/${encode(id)}/pull-requests", body), Hex.serializer())
    }

    suspend fun mergePullRequest(id: String): Hex =
        decode(send("POST", "/api/hexes/${encode(id)}/merge", "{}"), Hex.serializer())

    suspend fun closePullRequest(id: String): Hex =
        decode(send("POST", "/api/hexes/${encode(id)}/close", "{}"), Hex.serializer())

    suspend fun pullRequestDiff(id: String): PullRequestDiff =
        get("/api/hexes/${encode(id)}/diff", PullRequestDiff.serializer())

    /** Every hex of a project (up to 1,000), for the pickers on the create screen. */
    suspend fun projectHexes(projectId: String): List<HexSummary> =
        get("/api/hexes?project=${encode(projectId)}&limit=1000", ListSerializer(HexSummary.serializer()))

    suspend fun createHex(req: CreateHexRequest): Hex =
        decode(send("POST", "/api/hexes", apiJson.encodeToString(CreateHexRequest.serializer(), req)), Hex.serializer())

    suspend fun createProject(req: CreateProjectRequest): CreateProjectResult =
        decode(
            send("POST", "/api/workspace/create", apiJson.encodeToString(CreateProjectRequest.serializer(), req)),
            CreateProjectResult.serializer(),
        )

    /** The request used for the live event stream; the caller owns the connection. */
    fun eventsRequest(): Request =
        request("/api/events").newBuilder().header("Accept", "text/event-stream").build()

    private fun encode(segment: String): String = java.net.URLEncoder.encode(segment, "UTF-8").replace("+", "%20")

    private suspend fun <T> get(path: String, serializer: DeserializationStrategy<T>): T =
        decode(send("GET", path, null), serializer)

    /** Sends a request and returns the response body text for a successful status. */
    private suspend fun send(method: String, path: String, json: String?): String {
        val builder = request(path).newBuilder()
        if (json != null) builder.method(method, json.toRequestBody(JSON))
        else if (method != "GET") builder.method(method, null)
        val response = execute(builder.build())
        return withContext(Dispatchers.IO) {
            response.use {
                checkStatus(it)
                it.body.string()
            }
        }
    }

    private fun <T> decode(body: String, serializer: DeserializationStrategy<T>): T =
        try {
            apiJson.decodeFromString(serializer, body)
        } catch (e: Exception) {
            throw ApiException.BadResponse(e)
        }

    private fun request(path: String): Request {
        // `resolve` keeps a query string; callers percent-encode the path segments themselves.
        val url = checkNotNull(connection.baseUrl.resolve(path)) { "bad path $path" }
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
                    continuation.resumeWithException(ApiException.Unreachable(e, "${request.url.host}:${request.url.port}"))
                }

                override fun onResponse(call: Call, response: Response) {
                    continuation.resume(response)
                }
            })
        }
}
