Automated Book Writer
This is a Node.js application designed to write a complete book using the Google Gemini API. By providing a few keywords and the desired number of chapters, the application progressively builds a detailed world, crafts characters, outlines a plot, and then writes the story paragraph by paragraph, chapter by chapter.
Features
World Building: Creates a rich setting based on initial keywords.
Location Generation: Populates the world with specific, interesting locations.
Character Creation: Develops a cast of characters relevant to the world and locations.
Chapter Outlining: Structures the entire book into a coherent chapter-by-chapter plot.
Iterative Writing: Writes the book by generating one paragraph at a time, summarizing the content after each addition to maintain continuity.
Deployment on Railway
This application is designed to be easily deployed on Railway.
Fork this repository to your own GitHub account.
Create a new project on Railway and connect it to your forked repository.
Configure Environment Variables: In your Railway project settings, go to the Variables tab and add the following environment variables:
GEMINI_API_KEY: Your API key for the Google Gemini API.
KEYWORDS: The core themes and genres of your book (e.g., "fantasy, epic journey, magic, ancient prophecy").
CHAPTER_COUNT: The desired number of chapters for your book (e.g., "10").
Deploy: Railway will automatically detect the Node.js application and deploy it. The script will run to completion, and the book's content will be printed to the logs.
Running Locally
To run this application on your local machine, follow these steps:
