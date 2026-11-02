# The official source

WhatsApp Web in a panel is one way to hear about new messages. This is the
other: Meta's WhatsApp Cloud API tells a small relay in your own Cloudflare
account, and COGNIX[WS] fetches from it. No panel has to be open, and messages
wait in the relay while your computer is off.

```
Contact → Meta → your relay (Cloudflare Worker + D1) ← this extension → Inbox, agent or Assistant
```

The extension opens no port. It only makes outgoing requests, so nothing on
your computer is reachable from the internet, and no server of ours is in the
path.

**Status: receiving only, not yet proven against Meta.** The whole path is
tested with signed events on one computer. A real Meta app has not been
connected, so the steps below may need adjusting. Sending is not here.

## Who does what

| | |
|---|---|
| **The person** | Connects the relay once, chooses who hears each contact and whether the text is shown. Reads the state on the page. |
| **The agent** | Receives a notice as a message from `ext:whatsapp`, marked as coming from a contact. Cannot send through this source, and cannot change routes. |
| **The system** | Checks Meta's signature, keeps events until they are fetched, removes duplicates, limits notices to 30 an hour, and files one Inbox note when receiving stops or messages are lost. |

## Set it up

You need a Meta developer account with a WhatsApp app, a Cloudflare account and
Node.js 24. Use your company's accounts for a company number.

1. Create the database and put its id in `relay/wrangler.jsonc`:
   ```
   cd relay
   npx wrangler d1 create picode-whatsapp-relay
   npx wrangler d1 execute picode-whatsapp-relay --remote --file schema.sql
   ```
2. Set three secrets. `APP_SECRET` comes from the Meta app's Basic settings; the
   other two are long random strings you make up:
   ```
   npx wrangler secret put APP_SECRET
   npx wrangler secret put VERIFY_TOKEN
   npx wrangler secret put RELAY_TOKEN
   ```
3. Deploy with `npx wrangler deploy` from `relay/`, and note the address.
4. In the Meta app, under WhatsApp ▸ Configuration, set the callback URL to
   `<relay address>/webhook` and the verify token to `VERIFY_TOKEN`. Subscribe to
   the `messages` field.
5. In COGNIX[WS], turn the extension on in at least one workspace (its process
   runs while it is on somewhere), open its settings, and enter the relay address
   and `RELAY_TOKEN`. Saving checks them against the relay.
6. Open the **Official connection** page. It should say Receiving. Send a message to
   the number; the person appears there to be given a route.

## What happens to a message

Decision table, covered in `test/source.test.mjs`, `test/relay.test.mjs` and
`test/meta.test.mjs`:

| Condition | What happens |
|---|---|
| Signature invalid or missing | Relay answers 401, stores nothing |
| Relay secrets not set | Relay answers 503, stores nothing |
| Database fails while storing | Relay answers 500, and Meta delivers again |
| Same delivery twice | Stored once, and a message id is never announced twice |
| Update over the database's row limit | Dropped and counted, one Inbox note |
| Not fetched within 14 days | Removed and counted, one Inbox note |
| From another number while a phone number ID is set | Ignored |
| Delivery status, or another field | Ignored |
| Contact with no route | Inbox, count only, never the text |
| Route to the Inbox or an agent, Show text off | Notice without the text |
| Route to the Inbox or an agent, Show text on | Notice with the text, each line quoted and marked as data |
| Route set to Off | Silent, and marked as handled |
| Agent cannot take it (stopped, deleted) | Inbox note without the text, saying who could not be reached |
| COGNIX[WS] not answering | What is left stays in the relay and returns on the next poll, without repeating what was delivered |
| Relay database recreated, numbering from 1 again | Still delivers, since this computer keeps no position in the relay |
| Over 30 notices in an hour | Held, and the next notice for that contact says how many |
| Relay refuses the token | State "Relay refused the token", backs off |
| Relay unreachable for 5 minutes | State "Relay not answering", one Inbox note until it recovers |

A crash between delivering a notice and recording it can repeat that one
notice. A repeated notice is preferred over a lost one.

## Security and privacy

- **Text from a contact is data.** It reaches an agent only for a contact you
  chose, quoted, with hidden characters removed and bounded to 1000 characters.
  This source does not use `messages:owner`, so it can never speak as you.
- **The extension stores no message text.** Its database holds contact ids and
  names, routes, and which ids were delivered. It travels in COGNIX[WS] backups.
- **The relay holds events until they are fetched**, up to 14 days, in your own
  D1 database, in the clear. Anyone with access to your Cloudflare account can
  read what is waiting there.
- **Meta, Cloudflare and the model provider** of any agent that reads the text
  all see it. Tell the people you talk to where that is required.
- **Meta's terms restrict AI providers** when AI is the primary functionality of
  what you offer. Using this for your own business with human approval is a
  different situation from selling an AI assistant on WhatsApp; check with
  someone who can advise you.

## Limits

- A contact who adopted a WhatsApp username can arrive with a business-scoped id
  and no phone number. Routes match either, but the same person can appear as a
  new contact when their ids change.
- Messages arrive in about 10 seconds, the polling interval. About 8,640 requests
  a day stay inside Cloudflare's free plan as of November 2026.
- Connecting a real number to the API has effects on the WhatsApp app and linked
  devices. Read Meta's current coexistence rules first.
