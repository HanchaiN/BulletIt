# How to contribute

For now, this is not a public project.
However, within the community, contributions are very much appreciated.

## How to file a bug report

Closed community: direct message or group chat.

## How to suggest a new feature

Closed community: direct message or group chat.
We'll discuss the protocol later; or did we?

## How to run

With NodeJS, of course. `npm start` will do.
Configuration is done via editing the code (some via environment variable), just don't accidentally push the new defaults.
We'll deal with configuration later.

With that said, test your code and whatever depends on your code.
Test everything if unsure.
Test manually if have to.

## Coding principle

 - Just make it work. Make it good comes later.
    - Self-documenting code is the best. Otherwise, just use standard docs for type hint.
    - Spaghetti are edible as long as it can be untangled.
    - If it works, don't touch it. But if it's tangled, go for it.
 - SQL is as deep as it goes.
    - ORM are overrated. Finish everything directly SQL if possible. Leave as little logic to JS as you can.
    - Migrations are there for a reason. Old ones are set in stone. At least until we decide to use other DB.
 - Browser compatibility is a bit too troublesome.
    - Accessibility is preferred. Try running without Client-side JS, print layout, or tab navigation. Broken UX/UI is better than completely inaccessible one.
    - With as little external dependencies as possible, use them as much as you can. Avoid writing your own scripts and, maybe, stylesheets.
        - HTMX is the new HTML. Or whatever framework we decide to use, if any.
