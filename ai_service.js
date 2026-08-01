// ============================================================
// SKIMR AI SERVICE — ZERO-KEY EDITION
// Uses Pollinations AI. 100% Free. No API keys required.
// ============================================================

export const AiService = {
  // Sanitize raw AI output text before parsing JSON
  cleanJsonText(rawText) {
    let cleaned = rawText.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    let jsonStr = jsonMatch[0];

    // Fix unescaped control characters inside JSON strings (e.g. raw newlines, tabs)
    jsonStr = jsonStr.replace(/[\u0000-\u001F]+/g, (match) => {
      if (match === '\n') return '\\n';
      if (match === '\r') return '\\r';
      if (match === '\t') return '\\t';
      return '';
    });

    return jsonStr;
  },

  async fetchWithRetry(prompt, isJson = true, attempt = 1) {
    const models = ['openai', 'qwen-coder', 'mistral'];
    const model = models[(attempt - 1) % models.length];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout limit

    try {
      const response = await fetch('https://text.pollinations.ai/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          jsonMode: isJson,
          model: model
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const rawText = await response.text();
      if (!rawText || !rawText.trim()) {
        throw new Error('Empty response from AI server');
      }

      return rawText;
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt < 3) {
        console.warn(`AiService attempt ${attempt} failed (${err.message}), retrying...`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
        return this.fetchWithRetry(prompt, isJson, attempt + 1);
      }
      throw err;
    }
  },

  async analyzeText(pageText) {
    // Truncate to ~10,000 chars for optimal balance of detail & speed
    const truncatedText = (pageText || '').substring(0, 10000);

    const prompt = `You are a highly intelligent academic assistant. I am going to give you the extracted text of a webpage or document. 
Please analyze it and extract key information.

Return ONLY a JSON object with this exact structure (no markdown formatting, no code blocks, just raw JSON):
{
  "title": "The exact title of the article/document",
  "authors": "Author names if visible, otherwise 'Unknown'",
  "summary": ["Key point 1", "Key point 2", "Key point 3", "Key point 4"],
  "flashcards": [
    {"q": "A highly specific question about the core content", "a": "A detailed, educational explanation (1-2 sentences)"},
    {"q": "Another question testing deep understanding", "a": "A detailed, educational explanation"}
  ]
}

CRITICAL: You must generate EXACTLY 4 to 6 high-quality flashcards. Make the answers detailed and helpful for a student studying for an exam.

Here is the document text:
"""
${truncatedText}
"""
`;

    try {
      const rawText = await this.fetchWithRetry(prompt, true);
      const cleaned = this.cleanJsonText(rawText);
      if (!cleaned) throw new Error('AI response did not contain JSON');
      
      const parsed = JSON.parse(cleaned);

      // Validate structure
      if (!parsed.title) parsed.title = 'Document Summary';
      if (!parsed.summary || !Array.isArray(parsed.summary)) parsed.summary = ['Summary unavailable.'];
      if (!parsed.flashcards || !Array.isArray(parsed.flashcards)) parsed.flashcards = [];

      return parsed;
    } catch (e) {
      console.error("AI Analysis failed:", e);
      throw new Error(`AI Analysis Failed: ${e.message}. Please try scanning again.`);
    }
  },

  async answerCustomFlashcard(question, pageText) {
    const truncatedText = (pageText || '').substring(0, 8000);

    const prompt = `You are a highly intelligent academic tutor. 
Based ONLY on the provided text, concisely answer the student's question. 
Make the answer detailed enough for a flashcard (1-3 sentences).

Return ONLY a JSON object:
{ "a": "The detailed answer" }

Student Question: "${question}"

Source Text:
"""
${truncatedText}
"""
`;

    try {
      const rawText = await this.fetchWithRetry(prompt, true);
      const cleaned = this.cleanJsonText(rawText);
      if (!cleaned) throw new Error('AI response did not contain valid JSON');
      
      const parsed = JSON.parse(cleaned);
      if (!parsed.a) throw new Error('Invalid answer field');
      return parsed.a;
    } catch (e) {
      console.error("Custom flashcard generation failed:", e);
      throw new Error(`Failed to generate flashcard: ${e.message}`);
    }
  }
};

