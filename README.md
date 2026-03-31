# Telegram Multilingual Auto-Poster Bot

A Node.js bot designed for automated translation via OpenAI API and cross-posting messages to multiple language-specific Telegram channels. Includes functionality for tracking subscriber counts, post views, an App-like "Single Message" UI, and a Server Status Scanner (SSS) with Down Detection.

---

## Configuration (.env & Admins)

BOT_TOKEN=...          
OPENAI_API_KEY=...     
CHANNEL_EN=-100...
CHANNEL_UA=-100...
CHANNEL_RU=-100...
CHANNEL_PL=-100...
CHANNEL_DE=-100...
CHANNEL_MAIN=-100...

Note on Admins: Admin IDs are now hardcoded directly in index.js (look for const ADMIN_IDS = '...';). You can list multiple IDs separated by commas. If the list is empty, the bot silently ignores all non-admin users.

---

## Features & Commands

* Clean UI (Single Message Mode): The bot operates entirely in a single message block. It automatically deletes user command messages (like /stat or text sent for translation) and dynamically updates its own menu to keep the chat history completely clean.

Commands:
* /start - Main menu with inline keyboard.
* /stat - Channel statistics (live subscribers + local post/view data).
* /post - Start a multilingual post flow.
* /updateviews - Pull view counts for last 20 posts via forward trick.
* /isdown - One-off check: is devbydnk.com up or down?
* /checklive - Force an immediate SSS status report.

---

## Server Status Scanner (SSS) & Down Detector

Toggle via the SSS button in the /start keyboard (label shows on ➕ or off ✖️).
When enabled:
1. Down Detector (5 min): The bot pings the target URL every 5 minutes. If the site goes down, it immediately sends an alert to all ADMIN_IDS. When the site recovers, it sends a "back online" notification.
2. Daily Report (24h): Sends a routine server status summary to all admins every 24 hours.

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

### Server Status Scanner (SSS) Errors
| Code | Error Description | Cause and Resolution |
| :--- | :--- | :--- |
| **33:14**| Scheduled SSS check failed | Failed to generate or send the automated 24h report (network issue or Telegram API error). |
| **33:15**| /isdown command error | Failed to execute the manual site check. |
| **33:16**| /checklive command error | Failed to gather and send the manual SSS report. |

---

## Installation and Setup

1. Clone the repository.
2. Run npm install.
3. Create a .env file based on the provided configuration.
4. Start the bot: node index.js