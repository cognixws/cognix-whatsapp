# Backlog

What is left for this extension, after v0.2.1 (2026-10-19). Items that need
COGNIX[WS] itself are tracked in its repository, in
`docs/handoff/open/extension-panels.md`; this file names them only so the
WhatsApp side stays readable in one place.

## Layout (recipe)

- [ ] Media gallery: the title is clipped and the "Documents" tab label wraps
      mid-word in a panel about 550 px wide.
- [ ] Channels: tapping a channel in the list showed no detail view. Not yet
      known whether the click or the render failed.
- [ ] Screens not toured yet in a narrow panel: a contact's or group's info,
      New chat, search inside a chat, the attach and emoji menus, a forwarded
      message dialog.
- [ ] Keep the recipe current: WhatsApp's generated class names change; the
      recipe relies on stable selectors (`#app`, `#side`, `#main`,
      `data-testid`, roles). Re-check after WhatsApp Web updates.

## Notifications (signals)

- [ ] Read WhatsApp's own notifications instead of the chat list: wrap the
      page's `Notification` at document start (a recipe script), so muted
      chats stay muted the way WhatsApp decides. Measured 2026-10-18: the
      page reads the permission once at load, so the wrapper must run before
      it.
- [ ] A chat filter that survives a renamed group (match by a stable id, if
      the page exposes one).
- [ ] Mentions: a separate signal when the account is mentioned in a group.

## Agents

- [ ] Let an agent subscribe itself to a chat ("tell me when the group X
      writes") instead of only the owner's Notifications… dialog
      (COGNIX[WS] side).
- [ ] Examples of Assistant instructions for WhatsApp notes: summarize,
      tell the owner only what is urgent, draft a reply and ask before
      sending.
- [ ] Sending: an agent replied live on 2026-10-19 with the browser verbs
      (`type` then `press Enter`). Note that `type` reported the field as
      empty right after typing although the message went out whole; check
      whether that answer can mislead an agent.

## Official source

- [x] Prove the path against a real Meta app and test number: time to the
      relay, event shape, and waiting in the relay until the extension started.
- [ ] Measure Meta's retries when the relay is down.
- [ ] Deliver to a running agent end to end. Tested with a fake host and with a
      refused agent, not yet with a live one.
- [ ] Sending, with the owner's approval on each message and the 24-hour window.
- [ ] Encrypt what waits in the relay.

## COGNIX[WS] side, seen while building the official source

- [ ] An extension with one page and a site panel shows two identical tiles,
      both named after the extension. The page's title should name its tile.
- [ ] `.pc-button.primary` has no hover in the page tokens: it comes after
      `.pc-button:hover` with equal specificity. This page overrides it locally.
- [ ] Saving checked settings right after turning an extension on answers "Could
      not confirm these settings" for the seconds before the process listens.
- [ ] `__picodePageAudit` does not enter an extension page's sandboxed frame.

## Policy

- [ ] Re-read WhatsApp's Terms on automated access and messaging before a
      wider release, and keep the README's guidance in line with them.
