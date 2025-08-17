const express = require('express');
const multer = require('multer');
// Import FormData for constructing multipart requests.  This package
// must be installed with `npm install form-data`.
const FormData = require('form-data');
// Import node-fetch for making HTTP requests.  Install with
// `npm install node-fetch`.  If your Node version supports the global
// fetch API, you can omit this require.  node-fetch v3 is an ESM
// module, so when using CommonJS (require) its default export is
// exposed via the `.default` property.  Destructure `.default` to get
// the fetch function.
const fetch = require('node-fetch').default;
// In modern Node (>=18) fetch is globally available.  If using older
// versions, install node-fetch and import it here.

// Replace these with your real bot token and the chat ID of the group
// where messages about orders should be sent.  Never commit real
// tokens to version control.
const BOT_TOKEN = '8259901446:AAFYni5pRxv3wIqMBnVboR-ng5fAUehPmR4';
const CHAT_ID   = '-1002703949173';
// Chat ID of the group/channel where donation commands should be sent.  This
// should be a different group from CHAT_ID.  Replace with the actual chat
// identifier of your donation group.
const DONATE_CHAT_ID = '-1003039867044';

const app = express();
const upload = multer();

// Serve static files (HTML, JS, CSS) from the project root so that the
// front‑end is available at the root URL.  This allows Express to
// deliver index.html and associated assets when someone visits `/`.
const path = require('path');
app.use(express.static(path.join(__dirname)));
// Explicitly handle the root URL by sending the index.html file.  Without
// this, visiting `/` would show “Cannot GET /”.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Allow cross-origin requests so that a static site served from a
// different port (e.g. http-server on port 8080) can send data to this
// API without CORS issues.  In production, restrict the origin as
// appropriate for your domain.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Accept form submissions at /api/order.  The form is expected to be a
// multipart/form-data request containing optional fields such as
// description, stars, price, username, recipientUsername, recipientId,
// buyerId and a file named 'screenshot'.  We don’t use the uploaded
// screenshot here but parsing it ensures that Multer processes the
// payload correctly.
app.post('/api/order', upload.single('screenshot'), async (req, res) => {
  const {
    description = '',
    stars = '',
    price = '',
    username = '',
    recipientUsername = '',
    recipientId = '',
    buyerId = ''
  } = req.body || {};

  // Determine what item is being purchased
  const item = stars ? `${stars} ⭐` : (description || 'товар');
  const amount = price ? Number(price).toLocaleString('ru-RU') + ' сум' : '';
  const purchaseTime = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' });

  // Compose the message for Telegram
  let msg = '🛍️ Новая покупка\n\n';
  msg += `⏰ Время покупки: ${purchaseTime}\n`;
  msg += `🎁 Товар: ${item}\n`;
  if (description) msg += `📄 Описание: ${description}\n`;
  msg += `👤 Покупатель: @${username}`;
  if (buyerId) msg += ` (ID: ${buyerId})`;
  msg += '\n';
  if (recipientUsername) {
    msg += `🎯 Получатель: @${recipientUsername}`;
    if (recipientId) msg += ` (ID: ${recipientId})`;
    msg += '\n';
  }
  if (amount) msg += `💰 Сумма: ${amount}\n`;

  // Determine donation parameters for the inline keyboard.  We want to
  // pre‑compute the purchase type (stars or premium), the recipient
  // username and the quantity.  This data will be encoded into the
  // callback_data so that the accept handler can reconstruct a
  // `/donate` command.
  const purchaseType = stars ? 'stars' : 'premium';
  // If stars is provided, use it as the quantity; otherwise try to
  // extract the months from the description (e.g. 3, 6 or 12).  Default
  // to 1 if nothing can be parsed.
  let donationAmount;
  if (stars) {
    donationAmount = String(stars).trim() || '1';
  } else {
    let m;
    if (description) {
      // Look for 3, 6 or 12 in the description.  This covers common
      // premium durations of 3, 6 or 12 months.
      m = description.match(/\b(12|6|3)\b/);
    }
    donationAmount = m ? m[1] : '1';
  }
  // Determine which username should receive the donation.  According
  // to the requirements, if a recipientUsername is provided we use
  // that; otherwise fall back to the buyer’s username.
  const donateUsername = recipientUsername || username;
  // Build the callback_data for the accept button.  Use a simple
  // pipe‑separated string to stay within Telegram’s 64‑byte limit for
  // callback data.  Format: accept|<type>|<username>|<amount>
  const acceptCallback = `accept|${purchaseType}|${donateUsername}|${donationAmount}`;
  const rejectCallback = 'reject';
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: 'Принять', callback_data: acceptCallback },
        { text: 'Отклонить', callback_data: rejectCallback }
      ]
    ]
  };

  // Send the message to Telegram.  If there is a screenshot, use
  // sendPhoto with caption and attach the inline keyboard; otherwise
  // send a plain text message with inline keyboard.  Avoid duplicating
  // the sending logic.
  try {
    if (BOT_TOKEN && CHAT_ID) {
      if (req.file) {
        const form = new FormData();
        form.append('chat_id', CHAT_ID);
        form.append('caption', msg);
        form.append('photo', req.file.buffer, {
          filename: req.file.originalname || 'screenshot.png',
          contentType: req.file.mimetype || 'application/octet-stream'
        });
        form.append('reply_markup', JSON.stringify(replyMarkup));
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
          method: 'POST',
          body: form,
          headers: form.getHeaders()
        });
      } else {
        // Use JSON body for sendMessage to include reply_markup.
        const payload = {
          chat_id: CHAT_ID,
          text: msg,
          reply_markup: replyMarkup
        };
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
    }
  } catch (err) {
    console.error('Failed to send message to Telegram:', err);
  }
  res.json({ success: true });
});

// Telegram webhook endpoint to handle callback queries from inline
// keyboards.  When a user taps the "Принять" or "Отклонить" button
// attached to a message, Telegram sends an update to your bot.  This
// handler inspects the callback_data to perform the appropriate
// action: either delete the original message (reject) or forward a
// donation command to another group (accept).  See README for
// instructions on how to set your bot’s webhook to this endpoint.
app.post('/telegram-webhook', express.json(), async (req, res) => {
  try {
    const update = req.body;
    if (update && update.callback_query) {
      const callbackQuery = update.callback_query;
      const data = callbackQuery.data;
      // Always acknowledge the callback query to remove the loading
      // indicator in the Telegram client.  We will defer sending this
      // request until after our action completes.
      const answerCallback = async () => {
        try {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQuery.id })
          });
        } catch (e) {
          console.error('Failed to answer callback query:', e);
        }
      };
      if (data === 'reject') {
        // Delete the message that originated this callback.  This will
        // remove it from the chat.
        try {
          const chatId = callbackQuery.message.chat.id;
          const messageId = callbackQuery.message.message_id;
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage?chat_id=${chatId}&message_id=${messageId}`);
        } catch (e) {
          console.error('Failed to delete message on reject:', e);
        } finally {
          await answerCallback();
          return res.sendStatus(200);
        }
      } else if (typeof data === 'string' && data.startsWith('accept|')) {
        // Parse the callback data.  Expected format:
        // accept|<type>|<username>|<amount>
        const parts = data.split('|');
        if (parts.length >= 4) {
          const [, type, usernamePart, amount] = parts;
          // Ensure username is prefixed with '@'.  If it already is,
          // avoid duplicating the symbol.
          const atUsername = usernamePart.startsWith('@') ? usernamePart : `@${usernamePart}`;
          const donateMsg = `/donate ${type} ${atUsername} ${amount}`;
          try {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: DONATE_CHAT_ID,
                text: donateMsg
              })
            });
          } catch (e) {
            console.error('Failed to forward donation command:', e);
          }
        }
        // Optionally, you could also edit the original message or remove
        // its keyboard here.  For simplicity we only acknowledge the
        // callback.
        await answerCallback();
        return res.sendStatus(200);
      }
    }
    // If no callback_query is present, just return OK.
    return res.sendStatus(200);
  } catch (err) {
    console.error('Error processing Telegram webhook:', err);
    return res.sendStatus(500);
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Order API server listening on port ${PORT}`);
});
