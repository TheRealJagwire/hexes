# kotlinx.serialization keeps its generated serializers via its own consumer rules.

# The markdown renderer and OkHttp ship consumer rules; these silence optional-dependency warnings.
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**
-dontwarn okhttp3.internal.platform.**
