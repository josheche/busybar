// Draw priority ladder. The device accepts a draw when priority >= the running
// app's priority. Built-in apps run at 10; an active BUSY/CUSTOM focus session
// runs at 90 — so anything below 90 automatically yields to focus time.
// Equal priority + different application_name = last writer wins, so widgets
// that may run at the same time need distinct rungs.
export const AMBIENT = 15 // now-playing, clocks, passive widgets
export const ASSISTANT = 20 // coding-agent session status; sits above now-playing while work is running
export const EVENT = 50 // one-shot notifications worth a glance
export const DEPLOY = 60 // deploy lifecycle status
export const NEEDS_HUMAN = 95 // blocked agents, incidents — breaks through focus
