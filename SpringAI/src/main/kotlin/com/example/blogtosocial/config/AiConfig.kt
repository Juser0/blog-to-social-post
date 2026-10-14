package com.example.blogtosocial.config

import org.springframework.ai.chat.client.ChatClient
import org.springframework.ai.chat.client.advisor.ChatModelCallAdvisor
import org.springframework.ai.chat.model.ChatModel
import org.springframework.ai.openai.OpenAiChatModel
import org.springframework.ai.openai.OpenAiChatOptions
import org.springframework.ai.openai.api.OpenAiApi
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

/**
 * 부팅 시 AI 연결 1회 확정. Next의 lib/adapters에 대응한다.
 * OpenRouter(OpenAI 호환) 엔드포인트에 Spring AI OpenAI 클라이언트로 붙는다.
 */
@Configuration
class AiConfig(
    @Value("\${openrouter.api-key:}") private val apiKey: String,
    @Value("\${openrouter.base-url:https://openrouter.ai/api/v1}") private val baseUrl: String,
    @Value("\${openrouter.model:nvidia/nemotron-3-ultra-550b-a55b:free}") private val defaultModel: String,
) {
    @Bean
    fun openAiApi(): OpenAiApi {
        // Spring AI는 경로에 /v1/chat/completions을 스스로 붙이므로,
        // Next와 같은 OPENROUTER_BASE_URL(…/api/v1)을 쓰면 /v1이 중복돼 404가 난다. 여기서 한 겹 벗긴다.
        val springBaseUrl = if (baseUrl.trimEnd('/').endsWith("/v1")) {
            baseUrl.trimEnd('/').removeSuffix("/v1")
        } else {
            baseUrl
        }
        return OpenAiApi.builder()
            .baseUrl(springBaseUrl)
            .apiKey(apiKey)
            .build()
    }

    @Bean
    fun chatModel(openAiApi: OpenAiApi): ChatModel {
        return OpenAiChatModel.builder()
            .openAiApi(openAiApi)
            .defaultOptions(
                OpenAiChatOptions.builder()
                    .model(defaultModel)
                    .build(),
            )
            .build()
    }

    @Bean
    fun chatClient(builder: ChatClient.Builder, chatModel: ChatModel): ChatClient {
        // 1.1의 ChatClient는 호출 체인에 모델 호출 어드바이저가 반드시 있어야 한다.
        // Boot 자동 구성이 넣어주지 않으므로 터미널 어드바이저를 직접 등록한다.
        return builder
            .defaultOptions(
                OpenAiChatOptions.builder()
                    .model(defaultModel)
                    .build(),
            )
            .defaultAdvisors(
                ChatModelCallAdvisor.builder().chatModel(chatModel).build(),
            )
            .build()
    }
}
