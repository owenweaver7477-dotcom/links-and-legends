/* =========================================================================
   difficulty.js — how much the game tells you
   -------------------------------------------------------------------------
   Every player has been playing the same round: a full aim line, a putt
   read with the borrow drawn on the green, a club chosen for them, the wind
   to the decimal, and a swing meter with a sweet spot you can hit while
   thinking about something else. That is the right game for somebody's
   first nine holes and it is a fairly boring one by their hundredth,
   because none of the decisions are theirs any more.

   WHAT A MODE CHANGES, AND WHAT IT DOES NOT.

   It changes what you are TOLD. It does not change the ball, the wind, the
   terrain or the physics, and that is a hard line — a mode that made the
   ball fly further would make the leaderboards meaningless, and a mode that
   made the wind harsher would mean two players in the same room were
   playing different weather. Everyone in a room plays the identical golf
   course in the identical conditions. They just have different amounts of
   help reading it.

   That is also why this is a per-PLAYER setting and not a per-room one. You
   can play with a friend who wants the aim line while you play without it,
   and the round is still a fair round, because neither of you has been
   given an advantage — one of you has been given a crutch.

   THE ONE THING IT DOES CHANGE. Harder modes earn more, and course records
   are only accepted from Standard and above. Take the aids away and you
   ought to get something for it, or nobody would; and a record set with the
   line drawn for you sitting above a record set without it is not a
   comparison anybody would defend.
   ========================================================================= */

/* Every aid, named once. The client asks `aids.line`, never `mode === 'pro'`
   — so adding a mode is adding a row here, and a mode never has to be
   special-cased at the place the aid is drawn. */
export const DIFFICULTIES = [
  {
    id: 'casual',
    name: 'Casual',
    blurb: 'Everything drawn for you. The game teaches while you play.',
    earn: 0.8,
    records: false,
    aids: {
      line: 'full',        // the aim line, all the way to where it lands
      putt: 'full',        // the borrow, drawn on the green
      club: true,          // a club picked for you when it is your turn
      wind: 'exact',       // "8 mph, helping 1.2 clubs"
      power: 'marked',     // the sweet spot marked on the meter
      forgive: 1.30,       // and a wider one
      gimme: 1.2,          // conceded putts, in metres
      trace: true          // the shot line stays up after the ball stops
    }
  },
  {
    id: 'standard',
    name: 'Standard',
    blurb: 'The aids you would have on a real course, and no more.',
    earn: 1,
    records: true,
    aids: {
      line: 'partial',     // direction and carry, not the roll-out
      putt: 'arrow',       // which way it breaks, not how much
      club: true,
      wind: 'exact',
      power: 'marked',
      forgive: 1,
      gimme: 0.6,
      trace: true
    }
  },
  {
    id: 'pro',
    name: 'Pro',
    blurb: 'No putt read, no marked sweet spot. Judge it yourself.',
    earn: 1.35,
    records: true,
    aids: {
      line: 'aim',         // a short line showing where you are pointed
      putt: 'none',
      club: false,         // pick your own club
      wind: 'rough',       // "a couple of clubs, off the left"
      power: 'blind',      // the meter runs, nothing is marked on it
      forgive: 0.85,
      gimme: 0.3,
      trace: true
    }
  },
  {
    id: 'tournament',
    name: 'Tournament',
    blurb: 'You, the wind and the flag. Nothing else on the screen.',
    earn: 1.75,
    records: true,
    aids: {
      line: 'none',
      putt: 'none',
      club: false,
      wind: 'rough',
      power: 'blind',
      forgive: 0.7,
      gimme: 0,            // hole everything out
      trace: false         // not even the line your own ball drew
    }
  }
];

export const DEFAULT_DIFFICULTY = 'standard';

export const difficultyById = id =>
  DIFFICULTIES.find(d => d.id === id) || DIFFICULTIES[1];

/** The aids for a mode, safe against a missing or invented id. */
export const aidsFor = id => difficultyById(id).aids;

/**
 * The server's gate. A client can send anything; a mode it does not know
 * becomes the default rather than an error, because an unknown mode is far
 * more likely to be an old tab than an attack — and dropping the player
 * into Standard is a correct answer either way.
 */
export const normaliseDifficulty = id =>
  DIFFICULTIES.some(d => d.id === id) ? id : DEFAULT_DIFFICULTY;

/** What a round earns, as a multiplier on coins and XP. */
export const earnRate = id => difficultyById(id).earn;

/** Whether a round on this mode may set a course or hole record. */
export const allowsRecords = id => difficultyById(id).records === true;

/**
 * A one-line badge for scoreboards: who was playing with what.
 * Standard is the norm and gets no badge — a label on everybody is noise.
 */
export const difficultyBadge = id => {
  const d = difficultyById(id);
  return d.id === DEFAULT_DIFFICULTY ? '' : d.name;
};
