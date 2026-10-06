// Shared userscript module. Loaded by Tampermonkey @require.
(function () {
    "use strict";
    const api = globalThis.BannerAutomation ??= {};

class EventBus {
    constructor() {
        this.events = new Map(); // pattern -> Set<{ fn, parsed }>
    }

    debounce(func, delay) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    subscribe(events, fn) {
        const eventList = Array.isArray(events) ? events : [events];
        const unsubs = [];

        eventList.forEach(pattern => {
            const listeners = this.events.get(pattern) || new Set();

            const entry = {
                fn,
                parsed: this.parseEvent(pattern)
            };

            listeners.add(entry);
            this.events.set(pattern, listeners);

            unsubs.push(() => {
                listeners.delete(entry);
                if (listeners.size === 0) {
                    this.events.delete(pattern);
                }
            });
        });

        return () => unsubs.forEach(u => u());
    }

    once(event, fn) {
        const unsub = this.subscribe(event, (data) => {
            unsub();
            fn(data);
        });
        return unsub;
    }

    emit(event, data) {
        const parsedEvent = this.parseEvent(event);

        for (const listeners of this.events.values()) {
            for (const { fn, parsed } of listeners) {
                if (this.matchParsed(parsed, parsedEvent)) {
                    fn(data);
                }
            }
        }
    }

    bindInput(inputEl, eventName, debounce = false) {
        let handler = (e) => {
            this.emit(`${inputEl.dataset.key}:${eventName}`, {
                key: inputEl.dataset.key,
                eventName: eventName,
                value: e.target.type === "checkbox" ? e.target.checked : (e.target.value || null),
                element: e.target,
                rawEvent: e
            });
        };

        if (eventName === "input" || debounce) {
            handler = this.debounce(handler, 300);
        }

        inputEl.addEventListener(eventName, handler);
    }

    bindChildren(inputEl){
        inputEl.querySelectorAll("[data-events]").forEach((el) => {
            const events = el.dataset.events.split(",").map(e => e.trim()).filter(Boolean);
            events.forEach(event => this.bindInput(el, event));
        });
    }

    matchPath(patternSegs, eventSegs) {
        let patternIdx = 0;
        let eventIdx = 0;

        while (patternIdx < patternSegs.length && eventIdx < eventSegs.length) {
            const pattern = patternSegs[patternIdx];

            if (pattern === "**") {
                // ** at end matches everything remaining
                if (patternIdx === patternSegs.length - 1) return true;

                // Try to match next pattern segment
                const nextPattern = patternSegs[patternIdx + 1];

                while (eventIdx < eventSegs.length) {
                    const isMatch = nextPattern === "*" || nextPattern === eventSegs[eventIdx];
                    if (isMatch && this.matchPath(patternSegs.slice(patternIdx + 1), eventSegs.slice(eventIdx))) {
                        return true;
                    }
                    eventIdx++;
                }

                return false;
            }

            // Single wildcard or exact match
            if (pattern !== "*" && pattern !== eventSegs[eventIdx]) {
                return false;
            }

            patternIdx++;
            eventIdx++;
        }

        // Consume trailing wildcards
        while (patternSegs[patternIdx] === "**") {
            patternIdx++;
        }

        return patternIdx === patternSegs.length && eventIdx === eventSegs.length;
    }

    parseEvent(str) {
        const [pathPart, eventPart] = str.split(":");

        return {
            path: pathPart ? pathPart.split(".") : [],
            event: eventPart || null
        }
    }

    matchParsed(pattern, event) {
        // Check event type match first
        const eventMatches = !pattern.event ||
                           pattern.event === "*" ||
                           pattern.event === event.event;
        
        if (!eventMatches) return false;

        return this.matchPath(pattern.path, event.path);
    }
}

    api.EventBus = EventBus;
})();
