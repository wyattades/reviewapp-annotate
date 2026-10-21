import type { Participant, ReviewEvent } from "./events";

/**
 * Telling people on Slack about what happens in a review app. Nothing here
 * talks to Slack or knows who anyone is on it: you say how to find a person's
 * Slack id (`resolveSlackUser`) and how to send (`send`), and this decides who
 * hears about what and what the message says.
 *
 *     createHandler({
 *       onEvent: slackNotifier({ resolveSlackUser, send }),
 *       // ...
 *     });
 */

/** Someone to tell: the PR's author (a GitHub login), or a person who comments in your app. */
export type Recipient =
  { kind: "github"; login: string } | { kind: "user"; id: string };

/** A Slack message: what `chat.postMessage` takes, besides the channel. */
export type SlackMessage = {
  /** the text for notifications and screen readers */
  text: string;
  blocks: SlackBlock[];
};

export type SlackBlock = Record<string, unknown>;

/**
 * Who hears about an event:
 *
 * - a new thread: the PR's author (not for a bot's PR);
 * - a reply: everyone else in the thread, so the PR's author only if they're in it;
 * - a thread ticked off: no one.
 *
 * The person who did it never hears about their own change, but only the host
 * can tell when the PR's author is that person: see `slackNotifier`.
 */
export function recipientsFor(event: ReviewEvent): Recipient[] {
  switch (event.type) {
    case "thread-created": {
      const author = event.pull.author;
      return author && author.type !== "Bot"
        ? [{ kind: "github", login: author.login }]
        : [];
    }
    case "reply-added":
      return event.participants.map(userRecipient);
    case "thread-resolved":
      return [];
  }
}

const userRecipient = ({ id }: Participant): Recipient => ({
  kind: "user",
  id,
});

// --- the message ---

const QUOTE_LIMIT = 300;

/** Slack's mrkdwn treats these three as markup. */
const escapeSlack = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const shorten = (text: string, limit: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

/** A Slack quote: each line behind `>`. */
const quote = (text: string) =>
  escapeSlack(shorten(text, QUOTE_LIMIT))
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

/** The path of a page, for a context line. */
const pagePath = (url: string) => {
  try {
    const { pathname, search } = new URL(url);
    return pathname + search;
  } catch {
    return url;
  }
};

/** Whether an image is somewhere Slack can fetch it from: not the private repo it may be stored in. */
const isPublicImage = (url: string) =>
  /^https:\/\//.test(url) && !/^https:\/\/github\.com\//.test(url);

/**
 * What to tell a recipient about an event, for a thread or reply. `youArePrAuthor`
 * is for the PR's author hearing about a new thread ("on your pull request").
 * Null for events nobody is told about.
 */
export function slackMessage(
  event: ReviewEvent,
  { youArePrAuthor = false }: { youArePrAuthor?: boolean } = {},
): SlackMessage | null {
  if (event.type === "thread-resolved") return null;

  const pull = `<${event.pull.url}|${escapeSlack(event.pull.title)} #${event.pull.number}>`;
  const who = `*${escapeSlack(event.actor.name)}*`;
  const created = event.type === "thread-created";
  const headline = created
    ? `${who} commented on ${youArePrAuthor ? "your pull request" : "pull request"} ${pull}`
    : `${who} replied in a thread you're in, on ${pull}`;
  const text = created ? event.thread.text : event.reply.text;

  const blocks: SlackBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: headline } },
    { type: "section", text: { type: "mrkdwn", text: quote(text) } },
  ];

  const image = created
    ? event.thread.imageUrls.find(isPublicImage)
    : undefined;
  if (image) {
    blocks.push({
      type: "image",
      image_url: image,
      alt_text: "Screenshot of what the comment is about",
    });
  }

  const page = escapeSlack(pagePath(event.thread.pageUrl));
  const context = created
    ? `Review app comment · ${page} · \`${event.thread.selector.replace(/`/g, "'")}\``
    : `Replying to “${escapeSlack(shorten(event.thread.text, 80))}” · ${page}`;
  blocks.push(
    { type: "context", elements: [{ type: "mrkdwn", text: context }] },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open thread" },
          url: event.links.thread,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "View on the page" },
          url: event.links.page,
        },
      ],
    },
  );

  return {
    text: `${event.actor.name} ${created ? "commented on" : "replied in a thread on"} ${event.pull.title} #${event.pull.number}: ${shorten(text, 140)}`,
    blocks,
  };
}

// --- sending ---

export type SlackNotifierOptions = {
  /**
   * Finds someone's Slack user id (`U…`), or null when they have none (a bot,
   * someone who isn't in your workspace): they're skipped. Asked for the
   * person who did it too, so the PR's author isn't told about their own comment.
   */
  resolveSlackUser: (who: Recipient) => Promise<string | null> | string | null;
  /** Sends the message to a Slack user: a direct message, by posting to their id as the channel. */
  send: (message: SlackMessage & { channel: string }) => Promise<unknown>;
};

/**
 * An `onEvent` that tells the right people on Slack (see `recipientsFor`),
 * once each, never the person who did it. One person's message failing to
 * send doesn't stop the others: it throws after trying everyone.
 */
export function slackNotifier({
  resolveSlackUser,
  send,
}: SlackNotifierOptions) {
  return async function notify(event: ReviewEvent) {
    const recipients = recipientsFor(event);
    if (!recipients.length) return;

    const actor = await resolveSlackUser({ kind: "user", id: event.actor.id });
    const channels = new Map<string, Recipient>();
    for (const recipient of recipients) {
      const slackId = await resolveSlackUser(recipient);
      if (slackId && slackId !== actor && !channels.has(slackId)) {
        channels.set(slackId, recipient);
      }
    }

    const failures: unknown[] = [];
    await Promise.all(
      [...channels].map(async ([channel, recipient]) => {
        const message = slackMessage(event, {
          youArePrAuthor: recipient.kind === "github",
        });
        if (!message) return;
        try {
          await send({ channel, ...message });
        } catch (error) {
          failures.push(error);
        }
      }),
    );
    if (failures.length) {
      throw new AggregateError(
        failures,
        `Couldn't tell ${failures.length} of ${channels.size} on Slack`,
      );
    }
  };
}
