// ============================================================
// SKIMR AI SERVICE — BULLETPROOF MULTI-ENGINE & OFFLINE FALLBACK
// Supports: Free Public AI + Custom Gemini/Groq Keys + Instant Offline NLP
// ============================================================

export const AiService = {
  // Clean raw AI output text into valid JSON
  cleanJsonText(rawText) {
    if (!rawText) return null;
    let cleaned = rawText.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    let jsonStr = jsonMatch[0];

    // Sanitize unescaped control characters inside JSON string literals
    jsonStr = jsonStr.replace(/[\u0000-\u001F]+/g, (match) => {
      if (match === '\n') return '\\n';
      if (match === '\r') return '\\r';
      if (match === '\t') return '\\t';
      return '';
    });

    return jsonStr;
  },

  // ------------------------------------------------------------
  // LAYER 1: USER CUSTOM GEMINI / GROQ API KEY PROVIDER
  // ------------------------------------------------------------
  async tryGeminiApi(apiKey, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    if (!response.ok) throw new Error(`Gemini API HTTP ${response.status}`);
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
  },

  // ------------------------------------------------------------
  // LAYER 2: ZERO-KEY PUBLIC AI PROVIDER WITH MODEL ROTATION
  // ------------------------------------------------------------
  async fetchPollinations(prompt, model = 'openai') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000);

    try {
      const response = await fetch('https://text.pollinations.ai/', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          jsonMode: true,
          model: model,
          seed: Math.floor(Math.random() * 1000000)
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rawText = await response.text();
      if (!rawText || !rawText.trim()) throw new Error('Empty response');
      return rawText;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  },

  // ------------------------------------------------------------
  // LAYER 3: INSTANT OFFLINE NLP EXTRACTIVE ENGINE (GUARANTEED FALLBACK)
  // ------------------------------------------------------------
  extractOfflineSummaryAndFlashcards(text) {
    console.warn("Using Skimr Offline NLP Engine...");
    const cleanedText = text.replace(/\s+/g, ' ').trim();
    
    // Split into sentences
    const sentences = cleanedText.match(/[^.!?]+[.!?]+/g) || [cleanedText];
    const validSentences = sentences
      .map(s => s.trim())
      .filter(s => s.length > 25 && s.length < 250);

    // Sentence Scoring (Frequency-based TF-IDF approximation)
    const wordFreq = {};
    const stopWords = new Set(['the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'is', 'are', 'was', 'were', 'been', 'has', 'had']);
    
    cleanedText.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).forEach(w => {
      if (w.length > 3 && !stopWords.has(w)) {
        wordFreq[w] = (wordFreq[w] || 0) + 1;
      }
    });

    const scoredSentences = validSentences.map(s => {
      const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
      let score = 0;
      words.forEach(w => { if (wordFreq[w]) score += wordFreq[w]; });
      return { sentence: s, score: score / (words.length || 1) };
    });

    scoredSentences.sort((a, b) => b.score - a.score);

    // Top sentences for summary
    const summaryPoints = scoredSentences.slice(0, 4).map(item => item.sentence);
    if (summaryPoints.length === 0) summaryPoints.push("Key concept extracted from document text.");

    // Generate Flashcards from top key sentences
    const flashcards = [];
    const keyItems = scoredSentences.slice(0, 5);

    keyItems.forEach((item, idx) => {
      const words = item.sentence.split(' ');
      if (words.length > 8) {
        const question = `What does the document state regarding: "${words.slice(0, 4).join(' ')}..."?`;
        const answer = item.sentence;
        flashcards.push({ q: question, a: answer });
      } else {
        flashcards.push({
          q: `Key Insight #${idx + 1}`,
          a: item.sentence
        });
      }
    });

    // Derive document title
    const firstSentence = validSentences[0] || 'Article Analysis';
    const title = firstSentence.length > 60 ? firstSentence.substring(0, 57) + '...' : firstSentence;

    return {
      title: title,
      authors: "Skimr Core Engine",
      summary: summaryPoints,
      flashcards: flashcards.length > 0 ? flashcards : [
        { q: "What is the primary topic of this text?", a: cleanedText.substring(0, 150) + "..." }
      ]
    };
  },

  // ------------------------------------------------------------
  // MAIN AI ENTRY POINT FOR DOCUMENT ANALYSIS
  // ------------------------------------------------------------
  async analyzeText(pageText) {
    const truncatedText = (pageText || '').substring(0, 5000);

    const prompt = `You are a highly intelligent academic assistant. Extract key information from this document.
Return ONLY a JSON object (no markdown, no code blocks):
{
  "title": "Title of article/document",
  "authors": "Author names if visible, otherwise 'Unknown'",
  "summary": ["Key point 1", "Key point 2", "Key point 3", "Key point 4"],
  "flashcards": [
    {"q": "A specific study question", "a": "Detailed answer (1-2 sentences)"},
    {"q": "Another specific question", "a": "Detailed answer"}
  ]
}
Generate 4 to 6 flashcards.

Document Text:
"""
${truncatedText}
"""`;

    // 1. Check for custom user Gemini API Key stored in chrome.storage
    try {
      const store = await new Promise(res => chrome.storage.local.get(['gemini_key'], res));
      if (store && store.gemini_key) {
        console.log("Using custom Gemini API key...");
        const raw = await this.tryGeminiApi(store.gemini_key, prompt);
        const cleaned = this.cleanJsonText(raw);
        if (cleaned) return JSON.parse(cleaned);
      }
    } catch (err) {
      console.warn("Custom API Key failed, falling back to public providers...", err);
    }

    // 2. Try Free Public Models Sequence
    const models = ['openai', 'mistral', 'qwen-coder'];
    for (const model of models) {
      try {
        console.log(`Analyzing text using public model: ${model}...`);
        const rawText = await this.fetchPollinations(prompt, model);
        const cleaned = this.cleanJsonText(rawText);
        if (cleaned) {
          const parsed = JSON.parse(cleaned);
          if (parsed.title && parsed.summary) return parsed;
        }
      } catch (err) {
        console.warn(`Public model ${model} failed (${err.message})...`);
      }
    }

    // 3. Guaranteed Fallback to Offline NLP Engine (Never fails!)
    return this.extractOfflineSummaryAndFlashcards(pageText);
  },

  // ------------------------------------------------------------
  // CUSTOM QUESTION / FLASHCARD ANSWERING
  // ------------------------------------------------------------
  async answerCustomFlashcard(question, pageText) {
    const truncatedText = (pageText || '').substring(0, 4000);
    const prompt = `Answer this question based on the text. Return ONLY JSON: { "a": "Detailed answer (1-3 sentences)" }\nQuestion: "${question}"\nText: """${truncatedText}"""`;

    // 1. Custom Gemini API Key check
    try {
      const store = await new Promise(res => chrome.storage.local.get(['gemini_key'], res));
      if (store && store.gemini_key) {
        const raw = await this.tryGeminiApi(store.gemini_key, prompt);
        const cleaned = this.cleanJsonText(raw);
        if (cleaned) return JSON.parse(cleaned).a;
      }
    } catch (err) {
      console.warn("Custom key flashcard failed:", err);
    }

    // 2. Public Models Sequence
    const models = ['openai', 'mistral', 'qwen-coder'];
    for (const model of models) {
      try {
        const rawText = await this.fetchPollinations(prompt, model);
        const cleaned = this.cleanJsonText(rawText);
        if (cleaned) {
          const parsed = JSON.parse(cleaned);
          if (parsed.a) return parsed.a;
        }
      } catch (err) {
        console.warn(`Custom Q&A model ${model} failed (${err.message})...`);
      }
    }

    // 3. Fallback answer generation from page text
    const sentences = (pageText || '').match(/[^.!?]+[.!?]+/g) || [];
    const match = sentences.find(s => s.toLowerCase().includes(question.toLowerCase().split(' ')[0])) || sentences[0];
    return match ? match.trim() : "Based on the text, no direct reference was found to answer this specific query.";
  }
};


