module.exports = {
  server: {
    cert:
      process.env.BROKER_CERT ||
      '/etc/letsencrypt/live/bugbot.electronjs.org/fullchain.pem',
    key:
      process.env.BROKER_KEY ||
      '/etc/letsencrypt/live/bugbot.electronjs.org/privkey.pem',
    port: Number.parseInt(process.env.BROKER_PORT, 10) || 8080,
    sport: Number.parseInt(process.env.BROKER_SPORT, 10) || 8443,
  },
};
