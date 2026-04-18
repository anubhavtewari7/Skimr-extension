// ============================================================
// SKIMR AI SERVICE — ZERO-KEY EDITION
// Uses Pollinations AI. 100% Free. No API keys required.
// ============================================================

export const AiService = {
  async analyzeText(pageText) {
    const prompt = `You are a highly intelligent academic assistant. I am going to give you the extracted text of a webpage or document. 
Please analyze it and extract the following information.

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

CRITICAL: You must generate EXACTLY 5 to 7 high-quality flashcards. Do not generate just 2. Make the answers detailed and helpful for a student studying for an exam.

Here is the document text:
"""
${pageText}
"""
`;

    const response = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        jsonMode: true,
        model: 'openai' // defaults to a highly capable model
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI Service Error: HTTP ${response.status}`);
    }

    const rawText = await response.text();
    
    // Clean and parse the response (sometimes AI wraps in ```json ... ```)
    const cleaned = rawText.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    
    try {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error();
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("Failed to parse JSON:", cleaned);
      throw new Error('AI response was not valid JSON. Please try scanning again.');
    }
  },

  async answerCustomFlashcard(question, pageText) {
    const prompt = `You are a highly intelligent academic tutor. 
Based ONLY on the provided text, concisely answer the student's question. 
Make the answer detailed enough for a flashcard (1-3 sentences).

Return ONLY a JSON object:
{ "a": "The detailed answer" }

Student Question: "${question}"

Source Text:
"""
${pageText}
"""
`;

    const response = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        jsonMode: true,
        model: 'openai'
      })
    });

    if (!response.ok) throw new Error('AI failed to generate flashcard.');

    const rawText = await response.text();
    const cleaned = rawText.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    
    try {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      return JSON.parse(jsonMatch[0]).a;
    } catch (e) {
      throw new Error('Failed to parse AI flashcard response.');
    }
  }
};
