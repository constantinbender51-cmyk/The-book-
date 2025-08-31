require('dotenv').config();

const { GoogleGenerativeAI } = require("@google/generative-ai");

const API_KEY = process.env.GEMINI_API_KEY;
const KEYWORDS = process.env.KEYWORDS;
const CHAPTER_COUNT = parseInt(process.env.CHAPTER_COUNT, 10);

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

  console.log("--- Starting book writing process ---");
  console.log(`Keywords: ${KEYWORDS}`);
  console.log(`Number of Chapters: ${CHAPTER_COUNT}`);
  console.log("-------------------------------------");

  try {
    // Stage 1: Create the world
    console.log("\n[1/5] Creating the world...");
    const worldPrompt = `Based on the keywords "${KEYWORDS}", create a detailed world for a book with ${CHAPTER_COUNT} chapters. Focus on the core concepts, history, and unique elements of the world. Provide a concise, single-paragraph description.`;
    const worldResponse = await model.generateContent(worldPrompt);
    world = worldResponse.text;
    console.log("World created.");

    // Stage 2: Create locations
    console.log("\n[2/5] Creating locations...");
    const locationsPrompt = `Using this world description: "${world}", create 3-5 key locations for a book. Describe each location briefly in a single paragraph.`;
    const locationsResponse = await model.generateContent(locationsPrompt);
    locations = locationsResponse.text;
    console.log("Locations created.");

    // Stage 3: Create characters
    console.log("\n[3/5] Creating characters...");
    const charactersPrompt = `Using this world description: "${world}" and these locations: "${locations}", create 3-5 main characters for the book. Briefly describe their personality, motivations, and role in the story.`;
    const charactersResponse = await model.generateContent(charactersPrompt);
    characters = charactersResponse.text;
    console.log("Characters created.");

    // Stage 4: Outline chapters
    console.log("\n[4/5] Outlining chapters...");
    const outlinePrompt = `Using the following world, locations, and characters, create a detailed, chapter-by-chapter outline for a book with ${CHAPTER_COUNT} chapters. The outline should guide the story's progression from beginning to end.
      World: "${world}"
      Locations: "${locations}"
      Characters: "${characters}"
    `;
    const outlineResponse = await model.generateContent(outlinePrompt);
    chapterOutline = outlineResponse.text;
    console.log("Chapter outline created.");

    // Stage 5: Iteratively write the book
    console.log("\n[5/5] Writing the book, paragraph by paragraph...");
    const chapters = chapterOutline.split(/Chapter \d+:/).filter(Boolean);

    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i].trim();
      console.log(`\n- Writing Chapter ${i + 1}/${CHAPTER_COUNT}...`);

      const paragraphPrompt = `
        You are an author writing a book. Your task is to write the next paragraph of the story.
        Here is the world description: "${world}"
        Here are the key locations: "${locations}"
        Here are the main characters: "${characters}"
        Here is the chapter outline: "${chapterOutline}"
        This is the current book content so far: "${bookContent}"
        This is a summary of the book so far: "${summary}"
        
        Write a single, new paragraph that continues the story based on the current chapter outline. Focus on the next logical step in the narrative.`;

      const paragraphResponse = await model.generateContent(paragraphPrompt);
      const newParagraph = paragraphResponse.text.trim();
      bookContent += `\n${newParagraph}`;
      
      // Update the summary for the next iteration
      const summaryPrompt = `Based on the following content, write a one-sentence summary of the book so far: "${bookContent}"`;
      const summaryResponse = await model.generateContent(summaryPrompt);
      summary = summaryResponse.text.trim();
    }
    
    console.log("\n--- Book Writing Complete! ---");
    console.log("\nFinal Book Content:");
    console.log(bookContent);

  } catch (error) {
    console.error("An error occurred during the writing process:", error);
  }
}

writeBook().catch(console.error);
