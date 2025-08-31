require('dotenv').config();

const { GoogleGenerativeAI, GoogleGenerativeAIError } = require("@google/generative-ai");

const API_KEY = process.env.GEMINI_API_KEY;
const KEYWORDS = process.env.KEYWORDS;
const CHAPTER_COUNT = parseInt(process.env.CHAPTER_COUNT, 10);

/**
 * Wraps the generateContent call with a retry and exponential backoff mechanism.
 * @param {object} model The GenerativeModel instance.
 * @param {string} prompt The prompt string to send.
 * @param {number} maxRetries The maximum number of retries.
 * @returns {Promise<string>} The generated text.
 */
async function safeGenerateContent(model, prompt, maxRetries = 5) {
    let retryCount = 0;
    while (retryCount < maxRetries) {
        try {
            const response = await model.generateContent(prompt);
            const generatedText = response.text;

            // Explicitly check for an undefined or empty response
            if (!generatedText) {
                throw new Error("API returned no text content. It may have been blocked by safety filters or an internal error occurred.");
            }

            return generatedText;
        } catch (error) {
            console.error(`Attempt ${retryCount + 1} failed: ${error.message}`);

            // Retry for API-related errors (429, 500) or our custom "no content" error
            // Any error that isn't a direct client-side problem should trigger a retry
            const isRetryableError = (error instanceof GoogleGenerativeAIError && (error.status === 429 || error.status >= 500)) || error.message.includes("API returned no text content");

            if (isRetryableError) {
                const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
                console.log(`Retrying in ${delay / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                retryCount++;
            } else {
                // If it's a different kind of error, re-throw it immediately
                throw error;
            }
        }
    }
    // If all retries fail, throw an error
    throw new Error(`Failed to generate content after ${maxRetries} retries.`);
}

async function writeBook() {
  if (!API_KEY || !KEYWORDS || isNaN(CHAPTER_COUNT)) {
    console.error("Missing required environment variables: GEMINI_API_KEY, KEYWORDS, or CHAPTER_COUNT.");
    return;
  }

  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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
    world = await safeGenerateContent(model, worldPrompt);
    console.log("World created.");

    // Stage 2: Create locations
    console.log("\n[2/5] Creating locations...");
    const locationsPrompt = `Using this world description: "${world}", create 3-5 key locations for a book. Describe each location briefly in a single paragraph.`;
    locations = await safeGenerateContent(model, locationsPrompt);
    console.log("Locations created.");

    // Stage 3: Create characters
    console.log("\n[3/5] Creating characters...");
    const charactersPrompt = `Using this world description: "${world}" and these locations: "${locations}", create 3-5 main characters for the book. Briefly describe their personality, motivations, and role in the story.`;
    characters = await safeGenerateContent(model, charactersPrompt);
    console.log("Characters created.");

    // Stage 4: Outline chapters
    console.log("\n[4/5] Outlining chapters...");
    const outlinePrompt = `Using the following world, locations, and characters, create a detailed, chapter-by-chapter outline for a book with ${CHAPTER_COUNT} chapters. The outline should guide the story's progression from beginning to end.
      World: "${world}"
      Locations: "${locations}"
      Characters: "${characters}"
    `;
    chapterOutline = await safeGenerateContent(model, outlinePrompt);
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

      let newParagraph = await safeGenerateContent(model, paragraphPrompt);
      newParagraph = newParagraph.trim();

      // Check for special markers
      const isChapterEnd = newParagraph.includes("END OF THE CHAPTER");
      const isBookEnd = newParagraph.includes("END OF THE BOOK");
      
      // Clean up the paragraph by removing the markers
      newParagraph = newParagraph.replace("END OF THE CHAPTER", "").replace("END OF THE BOOK", "").trim();

      bookContent += `\n\n${newParagraph}`;

      if (isChapterEnd) {
        console.log(`\n--- Chapter ${currentChapter} concluded. ---`);
        currentChapter++;
      }

      if (isBookEnd) {
        bookComplete = true;
        console.log(`\n--- Book concluded with Chapter ${currentChapter}. ---`);
      }
      
      // Update the summary for the next iteration
      const summaryPrompt = `Based on the following content, write a one-sentence summary of the book so far: "${bookContent}"`;
      summary = await safeGenerateContent(model, summaryPrompt);
      summary = summary.trim();
    }
    
    console.log("\n--- Book Writing Complete! ---");
    console.log("\nFinal Book Content:");
    console.log(bookContent);

  } catch (error) {
    console.error("An unrecoverable error occurred:", error);
  }
}

writeBook().catch(console.error);
