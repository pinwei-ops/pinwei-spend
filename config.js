// Public configuration. Nothing here is a secret: the OAuth Client ID is meant
// to be public, and the API URL is protected by ID-token checks on the backend.
// Never put the Telegram bot token or any other key in this repo.
window.APP_CONFIG = {
  CLIENT_ID: 'REPLACE_WITH_CLIENT_ID.apps.googleusercontent.com',
  API_URL: 'https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec',
};
