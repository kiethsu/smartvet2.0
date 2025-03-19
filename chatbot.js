// chatbot.js
const RiveScript = require("rivescript");
const path = require("path");

const bot = new RiveScript();

// Load brain files using the callback approach.
bot.loadDirectory(path.join(__dirname, "brain"), function(error) {
  if (error) {
    console.error("❌ Error loading RiveScript brain:", error);
  } else {
    console.log("✅ RiveScript brain loaded successfully!");
    bot.sortReplies();
  }
});

async function getReply(message, sessionId) {
  try {
    const reply = await bot.reply(sessionId, message);
    console.log("Debug: Received reply:", reply);
    return reply;
  } catch (err) {
    console.error("Error in getReply:", err);
    throw err;
  }
}

module.exports = { getReply };
