# Relay project instructions

## Standing execution authority

On 20 September 2026, the user instructed:

> Please proceed autonomously going forward and only stop if I am needed to resolve a blocker. Let this instruction persist for this project to its completion.

This is the current project-specific instruction. Together with the earlier explicit authorisation to commit and push as work progresses, it supersedes the earlier preferences requiring confirmation before commits and phase transitions. Continue through the agreed roadmap without routine approval pauses. Make reasonable implementation decisions, implement and verify changes, update documentation, and commit and push completed increments.

On 21 September 2026, the user reaffirmed this authority and asked that it be explicit in this file. For this project, the standing authorisation covers commits, pushes and phase transitions; do not request those confirmations again merely because global preferences normally require them.

Completing a task, milestone, commit, push or phase is a progress checkpoint, not a stopping point. Report the outcome briefly and continue with the next outstanding authorised roadmap item in the same working session. Do not end a working turn just to await another "proceed". Continue until the agreed roadmap is complete or a concrete blocker requires the user. Routine implementation choices are not blockers: use project context and sound judgement, recording consequential assumptions in the relevant documentation.

Ask the user only when progress requires their input, access, a material decision that cannot reasonably be inferred, or an action that governing tool/security rules require them to approve or perform. Explain the concrete blocker and complete independent authorised work while waiting. Do not infer permission for purchases, irreversible deletion, or sending messages beyond the user's authorised scope.

## Scope and progress

- Focus on the web app and its supporting backend. Preserve compatibility with existing clients; native UI development is outside the current scope.
- Read `docs/DEVELOPMENT-ROADMAP.md` for the current state, active phase and outstanding work.
- Maintain checked milestones for completed work and unchecked milestones for outstanding work, alongside narrative evidence. Distinguish local implementation/testing from deployed and verified features.
- Check parent items only when all their acceptance criteria are met. Update phase counts honestly.
- Keep the roadmap and relevant deployment/implementation records current in each meaningful increment.
- Preserve existing data and legitimate access. Keep credentials out of chat, logs and Git.

## Implementation preferences

- Add explanatory comments to functions longer than ten lines.
- Use specific, intent-based names.
- Flag candidates for removal with a comment rather than deleting immediately.
- Prefer tools that preserve existing features and produce verifiable results. If a preferred tool is unavailable, use a safe capable fallback, briefly report it and validate the result.
- Run checks appropriate to the change; do not repeat unrelated tests without a reason.
