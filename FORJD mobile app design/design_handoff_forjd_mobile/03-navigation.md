# Navigation

## Shell

Five tabs, always in this order, `AppDimens.tabBarHeight` 76, a 12px backdrop blur over
`rgba(14,14,15,.96)`, hairline top border.

| Tab | Icon | Root route |
|---|---|---|
| Home | `home` | `home` |
| Train | `train` | `train` |
| Progress | `progress` | `progress` |
| Rank | `rank` | `rank` |
| Profile | `profile` | `profile` |

Active tab is `#E9712F` with a w600 label; inactive is `#6B6B64` w500. Tapping the active
tab is a no-op (the prototype does not scroll-to-top; decide whether Flutter should).

**The tab bar is shown on detail screens too**, highlighting the tab the screen belongs to —
`workoutHistory` shows the bar with *Profile* lit, `location` with *Rank* (or *Profile* when
entered from settings), `weekly` with *Home*. That is deliberate: these are pushed routes
inside a branch, so `StatefulShellRoute.indexedStack` already gives it for free.

Screens **without** a tab bar, because they are modal, full-attention or a form:
`loading welcome login signup goals connect units editProfile pro managePlan builder
programBuilder live rest run sessionShare`.

Everything else carries the bar. The ones easy to get wrong: `done` and `runDone` show it
(Train), `catalog` shows it (Train), `weekly` and `notifsFeed` show it (Home), `notifs`,
`privacy` and `athlete`-from-privacy show it (Profile), and every InBody screen shows it
(Progress).

## Route graph

Arrows are forward navigation. `←key` means "returns to whatever `state.key` holds".

```
loading ──1.6s──▶ welcome
welcome ──▶ signup ──▶ goals ──▶ home        (first run; goalsReturnTo='newAccount')
welcome ──▶ login  ──▶ home

home ──▶ notifsFeed | weekly | train | exercise | progress | rank | profile
     └─▶ goSuggested: programOverview if following a program, else train

train ──▶ catalog | programBuilder | builder | workoutDetail | done | run | library
catalog ──▶ programOverview ──▶ programBuilder (Customise) | ←programReturnTo
workoutDetail ──▶ builder | live
programBuilder ──▶ builder | ←programBuilderReturnTo
builder ──▶ library (pick mode) | ←builderReturnTo

library ──▶ exercise | live (add to workout) | builder (add to routine) | train
exercise ──▶ ←exerciseReturnTo            (running variant ──▶ run)

live ⇄ rest ──▶ done ──▶ home | progress | sessionShare
run ──▶ runDone ──▶ home | progress | train | sessionShare

progress(Strength|Body|Recovery)
progressBody ──▶ inbody
inbody ──▶ inbodyConfirm | scanDetail | inbodyCompare | ←inbodyReturnTo
inbodyConfirm ──▶ progressBody

rank ──▶ location ──▶ ←locationReturnTo
rank ──▶ athlete (any row; your own row goes to profile) ──▶ ←athleteReturnTo

profile ──▶ editProfile | pro | units | connect | inbody | workoutHistory
        │   notifs | privacy | brand | welcome(log out)
privacy ──▶ location (locationReturnTo='privacy') | athlete (self preview)
editProfile ──▶ managePlan | pro
pro ──▶ ←proReturnTo
workoutHistory ──▶ workoutHistoryDetail
```

## The return-target contract

Nine screens are reachable from more than one place, so their back button cannot be a
constant. The prototype stores the origin in state at the moment of navigation:

| State field | Default | Set by |
|---|---|---|
| `goalsReturnTo` | `'profile'` | `signup` sets `'newAccount'`; profile sets `'profile'` |
| `proReturnTo` | `'profile'` | profile and editProfile |
| `inbodyReturnTo` | `'progressBody'` | profile sets `'profile'`; progressBody sets `'progressBody'` |
| `exerciseReturnTo` | `'library'` | library, home, live |
| `programReturnTo` | `'catalog'` | catalog, train, home |
| `programBuilderReturnTo` | `null` → `'train'` | programOverview |
| `builderReturnTo` | `'train'` | train, workoutDetail, programBuilder |
| `locationReturnTo` | `'rank'` | rank sets `'rank'`; the privacy screen sets `'privacy'`. The screen's tab bar follows — Rank from Rank, Profile otherwise |
| `athleteReturnTo` | `'rank'` | rank sets `'rank'`; the privacy preview row sets `'privacy'`. Drives the back target and which tab lights |
| `libraryPickMode` | `false` | `'builder'` or `true` — changes the library's title, back target and row behaviour |

In Flutter this is `go_router` stack depth, not state: push the route and pop. **Do not port
the returnTo fields.** They exist only because the prototype has one flat `screen` value.
Two of them were genuinely wrong before the audit — see `06-audit-log.md` — which is exactly
the class of bug a real navigator does not have.

`libraryPickMode` is the exception: it is a real *mode*, not a return path. Model it as a
route parameter — `/library?pick=workout` / `?pick=routine` — because it changes the screen's
title ("Add Exercise" vs "Exercise Library") and what tapping a row does.

## Progress tabs

`progress`, `progressBody` and `progressRec` are one screen with a three-way segmented
control — **Strength · Body · Health** (the third tab read "Recovery" until design review; the
route key `progressRec` kept its name, the label did not). The prototype keeps both a `screen` key and a `progTab` value and reconciles them in
`componentDidUpdate`; that reconciliation is prototype plumbing. In Flutter it is one route
with a tab index — `/progress/:tab` or a `TabController`.

## Screens not on the prototype's left rail

The rail is a 28-item shortcut list. These 15 route keys are not on it and are reached only
by tapping through: `pro managePlan units sessionShare inbodyCompare scanDetail programOverview workoutDetail programBuilder workoutHistory workoutHistoryDetail notifsFeed editProfile runDone loading`. Plus `exerciseRun`, which is not a route key at all —
it is the variant `exercise` renders when the exercise's category is `Running`. None of them
are lesser screens.
