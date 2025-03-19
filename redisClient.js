// redisClient.js
const redis = require("redis");
const client = redis.createClient({ url: process.env.REDIS_URL });

client.connect().catch(console.error);

module.exports = client;
