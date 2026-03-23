# Telegram Multilingual Auto-Poster Bot

A Node.js bot designed for automated translation via OpenAI API and cross-posting messages to multiple language-specific Telegram channels. Includes functionality for tracking subscriber counts and post views.

---

## Error Handling Reference

The bot implements a structured logging system. All errors are prefixed with err 33:X for efficient log searching (e.g., using grep). Below is a breakdown of error codes and their respective solutions.

### Initialization and Configuration Errors
| Code | Error Description | Cause and Resolution |
| :--- | :--- | :--- |
| **33:1** | BOT_TOKEN is missing in .env | Critical. The bot cannot start. Ensure the BOT_TOKEN from BotFather is correctly set in the .env file. |
| **33:2** | OPENAI_API_KEY is missing in .env | Critical. OpenAI API key is missing. Check your .env configuration. |
| **33:8** | CHANNEL_[KEY] not set in .env... | Attempted to post to a channel with a missing ID. Verify variables like CHANNEL_EN, CHANNEL_UA, etc. |
| **33:13**| Failed to start | General Telegraf startup error (e.g., port conflict or Telegram server IP block). |

### Statistics and Database Errors
| Code | Error Description | Cause and Resolution |
| :--- | :--- | :--- |
| **33:3** | Error fetching statistics | Failed during /stat command. Usually occurs if the bot was removed from a channel and cannot execute getChatMembersCount. |
| **33:4** | Error (updateviews) | Failed during /updateviews. Telegram may be rate-limiting requests (FloodLimit) due to excessive message forwarding. |
| **33:5** | Error: ... (inline button) | Same as 33:3, but triggered via the inline callback button in the main menu. |

### OpenAI Errors (Generation and Parsing)
| Code | Error Description | Cause and Resolution |
| :--- | :--- | :--- |
| **33:6** | Failed to parse OpenAI response | API returned invalid JSON (model hallucination). Re-send the text to retry. |
| **33:7** | Translation for [CHANNEL] missing | The JSON response from OpenAI is missing a specific language key. Post for this channel will be skipped. |
| **33:11**| OpenAI error | Internal API error (timeout, insufficient balance, or server downtime). Check console for details. |
| **33:12**| OpenAI request failed | User notification for error 33:11. |

### Telegram API Errors (Broadcasting)
| Code | Error Description | Cause and Resolution |
| :--- | :--- | :--- |
| **33:9** | Send error [key] | Failed to send a translated post to a specific channel (e.g., bot lacks admin rights). Check console. |
| **33:10**| Send failed in [CHANNEL] | User notification for error 33:9 including the specific reason from Telegram API. |

---

## Installation and Setup

1. Clone the repository.
2. Run npm install.
3. Create a .env file based on the provided configuration.
4. Start the bot: node index.js.