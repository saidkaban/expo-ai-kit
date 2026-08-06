# expo-ai-kit consumer ProGuard/R8 rules (applied to apps that depend on this library).

# The optional EmbeddingGemma backend (androidEmbeddings config-plugin flag) is
# instantiated by reflection from ExpoAiKitModule — keep its constructor.
-keep class expo.modules.aikit.embeddings.EmbeddingGemmaBackend {
    <init>(android.content.Context);
}

# The optional ML Kit speech backend (speech config-plugin flag) is
# instantiated by reflection from ExpoAiKitModule — keep its constructor.
-keep class expo.modules.aikit.speech.MlKitSpeechBackend {
    <init>(android.content.Context);
}

# MediaPipe tasks-text ships no consumer rules; its JNI layer resolves Java
# classes by name. These rules are inert when the classes are absent
# (embeddings disabled).
-keep class com.google.mediapipe.** { *; }
-dontwarn com.google.mediapipe.**
