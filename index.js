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
    let text = JSON.stringify(response.response.candidates[0].content.parts[0].text, null, 2);
    //console.log(` response . \n${text}`);
    return text;
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
      // Log the full response object for debugging purposes
      const responseJson = response.response;
      //console.log("Full API response:", JSON.stringify(responseJson, null, 2));
      return response;
    } catch (error) {
      // The core change: Retry on ANY error.
      if (attempt < retries - 1) {
        let delay = initialDelay * Math.pow(2, attempt);
        
        // Check if the API response includes a specific retry delay
        const retryInfo = error.response?.data?.error?.details?.find(d => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
        if (retryInfo && retryInfo.retryDelay) {
          const apiDelaySeconds = parseFloat(retryInfo.retryDelay.replace('s', ''));
          delay = Math.max(delay, apiDelaySeconds * 1000);
        }
        
        console.warn(`An error occurred: ${error.message}. Retrying in ${delay / 1000} seconds... (Attempt ${attempt + 1}/${retries})`);
        await sleep(delay);
        attempt++;
      } else {
        throw error; // Re-throw the error if we've run out of retries
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
  
  try {
    await writeBookLogic(model);
  } finally {
    // No Redis client to quit.
  }
}

async function writeBookLogic(model) {
  let bookContent = "";
  let world = "";
  let locations = "";
  let characters = "";
  let chapterOutline = "";
  let summary = "Empty page, begin writing your book!";
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
    const locationsPrompt = `Using this world description: "${world}", create locations for a book. Describe each location briefly in a single paragraph.`;
    const locationsResponse = await callGenerativeAIWithRetry(locationsPrompt, model);
    locations = extractTextFromResponse(locationsResponse);
    console.log("Locations created.");

    // Stage 3: Create characters
    console.log("\n[3/5] Creating characters...");
    const charactersPrompt = `Using this world description: "${world}" and these locations: "${locations}", create characters for the book. Briefly describe their personality, motivations, and role in the story.`;
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
    console.log("Chapter outline created.\n");

    // Stage 5: Iteratively write the book, paragraph by paragraph
    console.log("\n[5/5] Writing the book, paragraph by paragraph...");

    let paragraph_count = 0;
    let previous_paragraph = "No previous paragraphs.";
    
    while (!bookComplete) {
       console.log(`\n- Writing Chapter ${currentChapter}...`);
      
      const paragraphPrompt = `
        You are an author writing a book. Your task is to write a single paragraph of a book, given the summary so far, world description, locations of the book, characters, and chapter outline.
        This is a summary of the book so far: "${summary}"
        This is the previous paragraph of the chapter: "${previous_paragraph}"
        Here is the world description: "${world}"
        Here are the key locations: "${locations}"
        Here are the characters: "${characters}"
        Here is the full chapter outline: "${chapterOutline}"
        
        Write a single paragraph, a single aspect, a fragment of the chapter ${currentChapter}/${CHAPTER_COUNT} that one time will make up the whole chapter. Perhaps this is a single sentence from the outline guiding the whole paragraph, or a single word.
        Paragraphs written so far: ${paragraph_count}/max. 30 per chapter
        
        Important instructions:
        - If this paragraph concludes a chapter, end your response with the exact phrase "END OF THE CHAPTER".
        - If this paragraph concludes the entire book, end your response with the exact phrase "END OF THE BOOK".`;

      console.log(`\nPrompt:\n${paragraphPrompt}`);

      const paragraphResponse = await callGenerativeAIWithRetry(paragraphPrompt, model);
      let newParagraph = extractTextFromResponse(paragraphResponse).trim();

      // Check for special markers
      const isChapterEnd = newParagraph.includes("END OF THE CHAPTER");
      const isBookEnd = newParagraph.includes("END OF THE BOOK");
      
      // Clean up the paragraph by removing the markers
      newParagraph = newParagraph.replace("END OF THE CHAPTER", "").replace("END OF THE BOOK", "").trim();
      
      if (newParagraph) {
        console.log(newParagraph);
      } else {
        console.warn("Generated paragraph was empty. Skipping.");
      }

      bookContent += `\n\n${newParagraph}`;
      previous_paragraph = newParagraph;

      if (isChapterEnd) {
        console.log(`\n--- Chapter ${currentChapter} concluded. ---`);
        paragraph_count = 0;
        previous_paragraph = "No previous paragraphs";
        currentChapter++;
      }

      if (isBookEnd) {
        bookComplete = true;
        console.log(`\n--- Book concluded with Chapter ${currentChapter}. ---`);
      }
      
      // Update the summary for the next iteration
      const summaryPrompt = `Based on the following content, write a summary of the book so far: "${bookContent}"`;
      const summaryResponse = await callGenerativeAIWithRetry(summaryPrompt, model);
      summary = extractTextFromResponse(summaryResponse).trim();

      // Add a 20-second pause between each AI call in the writing segment
      if (!bookComplete) {
        //console.log("Pausing for 20 seconds before writing the next paragraph...");
        await sleep(20000);
      }
      paragraph_count++;
    }
    
    console.log("\n--- Book Writing Complete! ---");
    console.log("\nFinal Book Content:");
    console.log(bookContent);

  } catch (error) {
    console.error("An error occurred during the writing process:", error);
  }
}

writeBook().catch(console.error);
