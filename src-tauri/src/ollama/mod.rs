//! Ollama integration for local LLM extraction
//!
//! Calls the Ollama REST API to extract structured content from transcripts.

use serde::{Deserialize, Serialize};
use std::time::Duration;

const OLLAMA_BASE_URL: &str = "http://localhost:11434";
const DEFAULT_MODEL: &str = "llama3.2:3b";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// Ollama client for making API calls
pub struct OllamaClient {
    client: reqwest::Client,
    base_url: String,
    model: String,
}

impl OllamaClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .unwrap_or_default(),
            base_url: OLLAMA_BASE_URL.to_string(),
            model: DEFAULT_MODEL.to_string(),
        }
    }

    #[allow(dead_code)]
    pub fn with_model(mut self, model: &str) -> Self {
        self.model = model.to_string();
        self
    }

    /// Check if Ollama is running and the model is available
    pub async fn health_check(&self) -> Result<OllamaStatus, String> {
        // Check if server is running
        let tags_url = format!("{}/api/tags", self.base_url);
        let response = self
            .client
            .get(&tags_url)
            .send()
            .await
            .map_err(|e| format!("Ollama not running: {}", e))?;

        if !response.status().is_success() {
            return Err("Ollama server returned error".to_string());
        }

        let tags: TagsResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

        let model_available = tags.models.iter().any(|m| {
            m.name
                .starts_with(&self.model.split(':').next().unwrap_or(&self.model))
        });

        Ok(OllamaStatus {
            running: true,
            model: self.model.clone(),
            model_available,
            available_models: tags.models.iter().map(|m| m.name.clone()).collect(),
        })
    }

    /// Generate a completion from Ollama
    pub async fn generate(&self, prompt: &str, system: Option<&str>) -> Result<String, String> {
        let url = format!("{}/api/generate", self.base_url);

        let request = GenerateRequest {
            model: self.model.clone(),
            prompt: prompt.to_string(),
            system: system.map(|s| s.to_string()),
            stream: false,
            options: Some(GenerateOptions {
                temperature: 0.3, // Lower temperature for more consistent extraction
                num_predict: 2048,
            }),
        };

        log::info!(
            "Sending request to Ollama: model={}, prompt_len={}",
            self.model,
            prompt.len()
        );

        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Failed to call Ollama: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Ollama returned {}: {}", status, body));
        }

        let result: GenerateResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

        log::info!(
            "Ollama response received: {} chars, eval_duration={:?}ms",
            result.response.len(),
            result.eval_duration.map(|d| d / 1_000_000)
        );

        Ok(result.response)
    }

    /// Extract content from transcript text using a user-defined prompt
    pub async fn extract_content(
        &self,
        transcript_text: &str,
        extraction_prompt: &str,
        system_prompt: Option<&str>,
    ) -> Result<ExtractionResult, String> {
        // Build the full prompt
        let full_prompt = format!(
            "{}\n\n---\nTRANSCRIPT:\n{}\n---\n\nExtract the requested information and respond in JSON format only.",
            extraction_prompt,
            transcript_text
        );

        let default_system = "You are a content extraction assistant. Analyze podcast transcripts and extract structured information. Always respond with valid JSON.";
        let system = system_prompt.unwrap_or(default_system);

        let response = self.generate(&full_prompt, Some(system)).await?;

        // Try to parse as JSON, or return raw response
        let json_value = extract_json_from_response(&response);

        Ok(ExtractionResult {
            raw_response: response,
            parsed_json: json_value,
        })
    }
}

impl Default for OllamaClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Extract JSON from LLM response (handles markdown code blocks)
fn extract_json_from_response(response: &str) -> Option<serde_json::Value> {
    let trimmed = response.trim();

    // Try direct parse first
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Some(json);
    }

    // Try to extract from markdown code block
    if let Some(start) = trimmed.find("```json") {
        let after_marker = &trimmed[start + 7..];
        if let Some(end) = after_marker.find("```") {
            let json_str = &after_marker[..end].trim();
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(json_str) {
                return Some(json);
            }
        }
    }

    // Try to find JSON object/array in response
    if let Some(start) = trimmed.find('{') {
        // Find matching closing brace
        let mut depth = 0;
        let mut end = start;
        for (i, c) in trimmed[start..].chars().enumerate() {
            match c {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = start + i + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
        if end > start {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&trimmed[start..end]) {
                return Some(json);
            }
        }
    }

    None
}

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Serialize)]
struct GenerateRequest {
    model: String,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<GenerateOptions>,
}

#[derive(Debug, Serialize)]
struct GenerateOptions {
    temperature: f32,
    num_predict: i32,
}

#[derive(Debug, Deserialize)]
struct GenerateResponse {
    response: String,
    #[serde(default)]
    eval_duration: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct TagsResponse {
    models: Vec<ModelInfo>,
}

#[derive(Debug, Deserialize)]
struct ModelInfo {
    name: String,
}

// ============================================================================
// Public Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaStatus {
    pub running: bool,
    pub model: String,
    pub model_available: bool,
    pub available_models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionResult {
    pub raw_response: String,
    pub parsed_json: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_json_from_response() {
        // Direct JSON
        let json = extract_json_from_response(r#"{"name": "test"}"#);
        assert!(json.is_some());

        // Markdown code block
        let json = extract_json_from_response(
            r#"Here's the result:
```json
{"items": [1, 2, 3]}
```
"#,
        );
        assert!(json.is_some());

        // JSON embedded in text
        let json =
            extract_json_from_response(r#"The extracted data is: {"value": 42} and that's it."#);
        assert!(json.is_some());
    }
}
