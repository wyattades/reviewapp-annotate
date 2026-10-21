import type { StoredItem, StoredReply } from "../shared";
import type { ReviewUser } from "./config";
import type { PullInfo } from "./github";

/** Someone in a thread, by the id `authenticate` gave them. */
export type Participant = { id: string; name: string };

type Common = {
  /** the PR the review app belongs to */
  pull: PullInfo;
  /** the thread, as it is now */
  thread: StoredItem;
  /** who did it */
  actor: ReviewUser;
  /**
   * Everyone else who has commented in the thread: its author and those who
   * replied, once each. Not the actor, and not people who replied on GitHub
   * itself (they have no id from your app).
   */
  participants: Participant[];
  links: {
    /** the thread in the PR's review comment, on GitHub */
    thread: string;
    /** the review app page it's about */
    page: string;
  };
};

/**
 * Something that happened in a review app, once it's saved to the PR. Changes
 * made on GitHub itself (a ticked box, a reply written by hand) don't come
 * through here: the server doesn't see them.
 */
export type ReviewEvent =
  | (Common & { type: "thread-created" })
  | (Common & { type: "reply-added"; reply: StoredReply })
  | (Common & { type: "thread-resolved"; resolved: boolean });

/** The people in a thread other than `exceptId`: its author and repliers who signed in to your app. */
export function participantsOf(
  thread: StoredItem,
  exceptId: string,
): Participant[] {
  const seen = new Set([exceptId]);
  const people: Participant[] = [];
  for (const who of [thread, ...thread.replies]) {
    // a reply written on GitHub has `github:Name`, which isn't anyone's id here
    if (who.authorId.startsWith("github:") || seen.has(who.authorId)) continue;
    seen.add(who.authorId);
    people.push({ id: who.authorId, name: who.author });
  }
  return people;
}
