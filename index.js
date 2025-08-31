require('dotenv').config();

const { GoogleGenerativeAI } = require("@google/generative-ai");
const Redis = require('ioredis');

const API_KEY = process.env.GEMINI_API_KEY;
const KEYWORDS = process.env.KEYWORDS;
const CHAPTER_COUNT = parseInt(process.env.CHAPTER_COUNT, 10);

/**
 * Safely extracts the text from a Generative AI API response.
 * @param {object} response The full API response object.
 * @returns {string} The extracted text, or an empty string if not found.
 */
function extractTextFromResponse(response) {
  try {
    // The text is nested within a specific path in the JSON response.
    return response.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (error) {
    console.error("Failed to extract text from API response:", error);
    return "";
  }
}

/**
 * Delays execution for a specified number of milliseconds.
 * @param {number} ms The number of milliseconds to wait.
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function callGenerativeAIWithRetry(prompt, model, retries = 10, initialDelay = 1000) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      const response = await model.generateContent(prompt);
      return response;
    } catch (error) {
      // Retry on 429 (Too Many Requests) and 503 (Service Unavailable)
      if ((error.status === 429 || error.status === 503) && attempt < retries - 1) {
        const delay = initialDelay * Math.pow(2, attempt); // Exponential backoff
        console.warn(`API error ${error.status}. Retrying in ${delay / 1000} seconds... (Attempt ${attempt + 1}/${retries})`);
        await sleep(delay);
        attempt++;
      } else {
        throw error; // Re-throw the error if it's not a retriable status or we've run out of retries
      }
    }
  }
  throw new Error("Failed to get a response from the API after multiple retries.");
}

async function writeBook() {
  if (!API_KEY || !KEYWORDS || isNaN(CHAPTER_COUNT)) {
    console.error("Missing required environment variables: GEMINI_API_KEY, KEYWORDS, or CHAPTER_COUNT.");
    return;
  }

  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
  const redis = new Redis();
  const redisKey = `book_content:${KEYWORDS.replace(/[^a-zA-Z0-9]/g, '_')}`;

  let bookContent = "";
  let world = "";
  let locations = "";
  let characters = "";
  let chapterOutline = "";
  let summary = "";
  let currentChapter = 1;
  let bookComplete = false;

  console.log("--- Starting book writing process ---");
  console.log(`Keywords: ${KEYWORDS}`);
  console.log(`Number of Chapters: ${CHAPTER_COUNT}`);
  console.log("-------------------------------------");

  try {
    // Stage 1: Create the world
    console.log("\n[1/5] Creating the world...");
    const worldPrompt = `Based on the keywords "${KEYWORDS}", create a detailed world for a book with ${CHAPTER_COUNT} chapters. Focus on the core concepts, history, and unique elements of the world. Provide a concise, single-paragraph description.`;
    const worldResponse = await callGenerativeAIWithRetry(worldPrompt, model);
    world = extractTextFromResponse(worldResponse);
    console.log("World created.");

    // Stage 2: Create locations
    console.log("\n[2/5] Creating locations...");
    const locationsPrompt = `Using this world description: "${world}", create 3-5 key locations for a book. Describe each location briefly in a single paragraph.`;
    const locationsResponse = await callGenerativeAIWithRetry(locationsPrompt, model);
    locations = extractTextFromResponse(locationsResponse);
    console.log("Locations created.");

    // Stage 3: Create characters
    console.log("\n[3/5] Creating characters...");
    const charactersPrompt = `Using this world description: "${world}" and these locations: "${locations}", create 3-5 main characters for the book. Briefly describe their personality, motivations, and role in the story.`;
    const charactersResponse = await callGenerativeAIWithRetry(charactersPrompt, model);
    characters = extractTextFromResponse(charactersResponse);
    console.log("Characters created.");

    // Stage 4: Outline chapters
    console.log("\n[4/5] Outlining chapters...");
    const outlinePrompt = `Using the following world, locations, and characters, create a detailed, chapter-by-chapter outline for a book with ${CHAPTER_COUNT} chapters. The outline should guide the story's progression from beginning to end.
      World: "${world}"
      Locations: "${locations}"
      Characters: "${characters}"
    `;
    const outlineResponse = await callGenerativeAIWithRetry(outlinePrompt, model);
    chapterOutline = extractTextFromResponse(outlineResponse);
    console.log("Chapter outline created.");

    // Stage 5: Iteratively write the book, paragraph by paragraph
    console.log("\n[5/5] Writing the book, paragraph by paragraph...");

    while (!bookComplete) {
      console.log(`\n- Writing Chapter ${currentChapter}...`);
      
      const paragraphPrompt = `
        You are an author writing a book. Your task is to write the next paragraph of the story.
        Here is the world description: "${world}"
        Here are the key locations: "${locations}"
        Here are the main characters: "${characters}"
        Here is the full chapter outline: "${chapterOutline}"
        This is the current book content so far: "${bookContent}"
        This is a summary of the book so far: "${summary}"
        
        Write a single, new paragraph that continues the story.
        
        Important instructions:
        - If this paragraph concludes a chapter, end your response with the exact phrase "END OF THE CHAPTER".
        - If this paragraph concludes the entire book, end your response with the exact phrase "END OF THE BOOK".`;

      const paragraphResponse = await callGenerativeAIWithRetry(paragraphPrompt, model);
      let newParagraph = extractTextFromResponse(paragraphResponse).trim();

      // Check for special markers
      const isChapterEnd = newParagraph.includes("END OF THE CHAPTER");
      const isBookEnd = newParagraph.includes("END OF THE BOOK");
      
      // Clean up the paragraph by removing the markers
      newParagraph = newParagraph.replace("END OF THE CHAPTER", "").replace("END OF THE BOOK", "").trim();

      bookContent += `\n\n${newParagraph}`;

      // Save content to Redis
      try {
        await redis.set(redisKey, bookContent);
        console.log(`Content for chapter ${currentChapter} saved to Redis.`);
      } catch (redisError) {
        console.error("Failed to save to Redis:", redisError);
      }

      if (isChapterEnd) {
        console.log(`\n--- Chapter ${currentChapter} concluded. ---`);
        currentChapter++;
      }

      if (isBookEnd) {
        bookComplete = true;
        console.log(`\n--- Book concluded with Chapter ${currentChapter}. ---`);
      }
      
      // Update the summary for the next iteration
      const summaryPrompt = `Based on the following content, write a full summary of the book so far: "${bookContent}"`;
      const summaryResponse = await callGenerativeAIWithRetry(summaryPrompt, model);
      summary = extractTextFromResponse(summaryResponse).trim();
    }
    
    console.log("\n--- Book Writing Complete! ---");
    console.log("\nFinal Book Content:");
    console.log(bookContent);

  } catch (error) {
    console.error("An error occurred during the writing process:", error);
  } finally {
    redis.quit();
  }
}

writeBook().catch(console.error);
