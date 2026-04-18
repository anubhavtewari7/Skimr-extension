// AI Service to interact with Gemini 1.5 Flash
export async function identifyAndSummarize(imageBase64, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const prompt = `
    IDENTIFY AND SUMMARIZE:
    1. Look at this screenshot. Identify the book, journal, or article.
    2. Provide the Title and Author.
    3. Generate a "Master Chapter Summary" (5-7 key points).
    4. Provide a Mermaid.js diagram code structure for the topic.
    5. Generate 3 key flashcards (JSON format: [{q, a}]).
    
    Return the response in a clean JSON format.
  `;

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inline_data: {
            mime_type: "image/jpeg",
            data: imageBase64
          }
        }
      ]
    }],
    generationConfig: {
      response_mime_type: "application/json",
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
}
