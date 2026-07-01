# Demo app ProGuard/R8 rules.
#
# Keep the Moshi-generated JsonAdapters and the model classes intact so JSON
# (de)serialization survives minification. play-services-tapandpay ships its own
# consumer rules, so no extra keeps are needed for TapAndPay itself.

-keep class com.sonholab.pushprovisioning.*JsonAdapter { *; }
-keep @com.squareup.moshi.JsonClass class com.sonholab.pushprovisioning.** { *; }
