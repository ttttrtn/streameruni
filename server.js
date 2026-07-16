require('dotenv').config();
const express = require('express');
const { TwitchClient } = require('./twitch');
const { Director } = require('./director');

const PORT = process.env.PORT || 3000;

const twitch = new TwitchClient({
  clientId: process.env.TWITCH_CLIENT_ID,
  accessToken: process.env.TWITCH_ACCESS_TOKEN,
});

const director = new Director(twitch);
director.start();

const app = express();

app.get('/api/status', (req, res) => {
  res.json(director.getStatus());
});

app.listen(PORT, () => {
  console.log(`[DIRECTOR] Dashboard listening on port ${PORT}`);
});

module.exports = { app, director };
