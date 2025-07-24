import { drumPatterns, synthPatterns } from './patterns.js';
import drum, {
    DRUM_HAND_LEFT,
    DRUM_HAND_RIGHT,
    COWBELL,
    FACE
} from './drum.js';
import {
    SYNTH_LEFT,
    SYNTH_BITS_LEFT,
    KEY_GUIDE,
    SYNTH_IDLE_HAND_LEFT,
    SYNTH_IDLE_HAND_RIGHT,
    SYNTH_PLAY_HAND_LEFT,
    SYNTH_PLAY_HAND_RIGHT
} from './synth.js';
import MIDI, { whiteKeys, idxToMidi } from './midi.js';
import css from './finger.css.js';
import * as c from './constants.js';
import { asArrayLike, stringBool } from './utils.js';

// --- Tone.js import for browser synth support ---
import * as Tone from 'tone';

// Wait for DOMContentLoaded before defining the custom element
function defineFingerSequencerWhenReady() {
    // Private symbols to not expose every variable to the outside
    const [
        $playback,
        $hold,
        $timer,
        $displayInstrument,
        $bpm,
        $stepDuration,
        $midi,
        $controlChannel,
        $resizeTimeout,
        $noteScheduled
    ] = [
        Symbol('playback'),
        Symbol('hold'),
        Symbol('timer'),
        Symbol('displayInstrument'),
        Symbol('bpm'),
        Symbol('stepDuration'),
        Symbol('midi'),
        Symbol('controlChannel'),
        Symbol('resizeTimeout'),
        Symbol('noteScheduled')
    ];

    const [
        $drumPlayback,
        $drumPlayhead,
        $drumPattern,
        $activeDrumNotes,
        $drumChannel
    ] = [
        Symbol('drumPlayback'),
        Symbol('drumPlayhead'),
        Symbol('drumPattern'),
        Symbol('activeDrumNotes'),
        Symbol('drumChannel')
    ];

    const [
        $synthPlayback,
        $synthPlayhead,
        $synthPattern,
        $activeSynthNotes,
        $synthChannel,
        $synthKeyX
    ] = [
        Symbol('synthPlayback'),
        Symbol('synthPlayhead'),
        Symbol('synthPattern'),
        Symbol('activeSynthNotes'),
        Symbol('synthChannel'),
        Symbol('synthKeyX')
    ];

    class Finger extends HTMLElement {
        static get observedAttributes() {
            return ['control-channel', 'drum-channel', 'synth-channel', 'bpm'];
        }
        constructor() {
            super();

            this._printWelcomeText();

            // Set some defaults
            this[$playback] = false;
            this[$drumPlayback] = false;
            this[$synthPlayback] = false;
            this[$bpm] = parseFloat(40);
            this[$drumPattern] = 0;
            this[$synthPattern] = 0;
            this[$activeDrumNotes] = null;
            this[$activeSynthNotes] = null;
            this[$controlChannel] = 1; // <-- Set to 14 for default
            this[$drumChannel] = 1;
            this[$synthChannel] = 2;
            this[$displayInstrument] = 'drum';

            // Look for MIDI devices
            this._initMIDI();

            // Show the SVG
            this.shadow = this.attachShadow({ mode: 'open' });

            const style = document.createElement('style');
            style.appendChild(document.createTextNode(css));
            this.shadow.appendChild(style);

            // --- SVG template robust handling ---
            const svgTemplate = document.getElementById('finger-svg');
            if (svgTemplate && svgTemplate.content) {
                this.shadow.appendChild(svgTemplate.content.cloneNode(true));
            } else {
                console.error('SVG template with id "finger-svg" not found!');
            }

            this.shadow.appendChild(document.createElement('finger-settings'));

            // --- Keyboard input support ---
            this._keyboardDrumPatterns = [];
            this._keyboardSynthPatterns = [];
            this._keyboardKeyMap = {
                // Map keys to pattern indices (QWERTY, left = drums, right = synths)
                // Drums: z x c v b n m
                'z': 0, 'x': 1, 'c': 2, 'v': 3, 'b': 4, 'n': 5, 'm': 6,
                // Synths: a s d f g h j
                'a': 7, 's': 8, 'd': 9, 'f': 10, 'g': 11, 'h': 12, 'j': 13
            };
            this._keyboardDown = new Set();

            this._onKeyDown = this._onKeyDown.bind(this);
            this._onKeyUp = this._onKeyUp.bind(this);

            // --- Tone.js synth setup ---
            this._toneSynth = new Tone.PolySynth(Tone.Synth).toDestination();
            this._toneDrum = new Tone.MembraneSynth().toDestination();
        }

        connectedCallback() {
            this._resetUI();

            this._resetDrums();
            this._idleDrums();

            this._resetSynths();
            this._idleSynths();

            this._updatePatternUI();

            setTimeout(() => this._sendSettingSizing());
            window.addEventListener('resize', () => {
                clearTimeout(this[$resizeTimeout]);
                this[$resizeTimeout] = setTimeout(() => {
                    this._sendSettingSizing();
                }, 100);
            });

            const settings = this.shadow.querySelector('finger-settings');
            settings.addEventListener(
                'drum-channel',
                evt => (this.drumChannel = evt.detail)
            );
            settings.addEventListener(
                'control-channel',
                evt => (this.controlChannel = evt.detail)
            );
            settings.addEventListener(
                'synth-channel',
                evt => (this.synthChannel = evt.detail)
            );

            window.addEventListener('keydown', this._onKeyDown);
            window.addEventListener('keyup', this._onKeyUp);
        }

        disconnectedCallback() {
            window.removeEventListener('keydown', this._onKeyDown);
            window.removeEventListener('keyup', this._onKeyUp);
        }

        _onKeyDown(e) {
            const key = e.key.toLowerCase();
            if (!this._keyboardKeyMap.hasOwnProperty(key)) return;
            if (this._keyboardDown.has(key)) return;
            this._keyboardDown.add(key);

            const patternIdx = this._keyboardKeyMap[key];
            if (patternIdx < 7) {
                if (!this[$drumPlayback]) {
                    this[$drumPlayhead] = 0;
                }
                this[$displayInstrument] = 'drum';
                this[$drumPlayback] = true;
                this.drumPattern = patternIdx;
                this._keyboardDrumPatterns.push(this.drumPattern);
            } else {
                if (!this[$synthPlayback]) {
                    this[$synthPlayhead] = 0;
                }
                this[$displayInstrument] = 'synth';
                this[$synthPlayback] = true;
                this.synthPattern = patternIdx;
                this._keyboardSynthPatterns.push(this.synthPattern);
            }
            this.playback = true;
        }

        _onKeyUp(e) {
            const key = e.key.toLowerCase();
            if (!this._keyboardKeyMap.hasOwnProperty(key)) return;
            this._keyboardDown.delete(key);

            const patternIdx = this._keyboardKeyMap[key];
            if (patternIdx < 7) {
                const idx = this._keyboardDrumPatterns.lastIndexOf(patternIdx);
                if (idx !== -1) this._keyboardDrumPatterns.splice(idx, 1);

                if (this._keyboardDrumPatterns.length === 0) {
                    if (this[$activeDrumNotes] !== null) {
                        this[$activeDrumNotes].forEach(n =>
                            this[$midi].send(this[$drumChannel], 'noteoff', n, 127)
                        );
                    }
                    if (this._keyboardSynthPatterns.length === 0) {
                        this.playback = false;
                    } else {
                        this[$displayInstrument] = 'synth';
                    }
                    this[$drumPlayback] = false;
                } else {
                    this.drumPattern = this._keyboardDrumPatterns[this._keyboardDrumPatterns.length - 1];
                }
            } else {
                const idx = this._keyboardSynthPatterns.lastIndexOf(patternIdx);
                if (idx !== -1) this._keyboardSynthPatterns.splice(idx, 1);

                if (this._keyboardSynthPatterns.length === 0) {
                    if (this[$activeSynthNotes] !== null) {
                        this[$activeSynthNotes].forEach(n =>
                            this[$midi].send(this[$synthChannel], 'noteoff', n, 127)
                        );
                    }
                    if (this._keyboardDrumPatterns.length === 0) {
                        this.playback = false;
                    } else {
                        this[$displayInstrument] = 'drum';
                    }
                    this[$synthPlayback] = false;
                } else {
                    this.synthPattern = this._keyboardSynthPatterns[this._keyboardSynthPatterns.length - 1];
                }
            }
        }

        attributeChangedCallback(name, oldVal, newVal) {
            name = name.replace(/-([a-z])/g, function(g) {
                return g[1].toUpperCase();
            });
            this[name] = newVal;
        }

        set playback(playback) {
            playback = stringBool(playback);
            if (this[$playback] !== playback) {
                if (playback) {
                    this[$drumPlayhead] = 0;
                    this[$synthPlayhead] = 0;
                    this[$timer] = null;
                    this[$noteScheduled] = true;
                    requestAnimationFrame(this._playBeat.bind(this));
                } else {
                    if (this[$activeDrumNotes] !== null) {
                        this[$activeDrumNotes].forEach(n =>
                            this[$midi].send(this[$drumChannel], 'noteoff', n, 127)
                        );
                    }
                    if (this[$activeSynthNotes] !== null) {
                        this[$activeSynthNotes].forEach(n =>
                            this[$midi].send(this[$synthChannel], 'noteoff', n, 127)
                        );
                    }
                }
                this[$playback] = playback;
            }
        }
        get playback() {
            return this[$playback];
        }

        set drumPattern(drumPattern) {
            if (this[$drumPattern] !== parseInt(drumPattern, 10)) {
                this[$drumPattern] = parseInt(drumPattern, 10);
                this[$displayInstrument] = 'drum';
                this._updatePatternUI();
            }
        }
        get drumPattern() {
            return this[$drumPattern];
        }

        set synthPattern(synthPattern) {
            if (this[$synthPattern] !== parseInt(synthPattern, 10)) {
                this[$synthPattern] = parseInt(synthPattern, 10);
                this[$displayInstrument] = 'synth';
                this._updatePatternUI();
            }
        }
        get synthPattern() {
            return this[$synthPattern];
        }

        set bpm(bpm) {
            if (Math.abs(parseFloat(this[$bpm]) - parseFloat(bpm)) > Number.EPSILON) {
                this[$bpm] = parseFloat(bpm);
                this[$stepDuration] = 60.0 / this[$bpm] / 4.0;
                this.setAttribute('bpm', parseFloat(bpm));
                this.shadow
                    .querySelector('svg')
                    .style.setProperty('--beat-s', this[$stepDuration] + 's');
                this.shadow
                    .querySelector('finger-settings')
                    .setAttribute('step-duration', this[$stepDuration]);
            }
        }
        get bpm() {
            return this[$bpm];
        }

        set controlChannel(controlChannel) {
            if (this[$controlChannel] !== parseInt(controlChannel, 10)) {
                this[$controlChannel] = parseInt(controlChannel, 10);
                this.setAttribute('control-channel', controlChannel);
            }
        }
        get controlChannel() {
            return this[$controlChannel];
        }

        set drumChannel(drumChannel) {
            if (this[$drumChannel] !== parseInt(drumChannel, 10)) {
                this[$drumChannel] = parseInt(drumChannel, 10);
                this.setAttribute('drum-channel', drumChannel);
            }
        }
        get drumChannel() {
            return this[$drumChannel];
        }

        set synthChannel(synthChannel) {
            if (this[$synthChannel] !== parseInt(synthChannel, 10)) {
                this[$synthChannel] = parseInt(synthChannel, 10);
                this.setAttribute('synth-channel', synthChannel);
            }
        }
        get synthChannel() {
            return this[$synthChannel];
        }

        _playBeat(timestamp) {
            let drumPattern = drumPatterns[this[$drumPattern]];
            let synthPattern = synthPatterns[this[$synthPattern]];

            if (this[$noteScheduled]) {
                this[$timer] = this[$midi].noteTimestamp || timestamp;
                this[$noteScheduled] = false;

                if (this[$drumPlayback]) {
                    this._playDrumNotes(
                        drumPattern[this[$drumPlayhead] % drumPattern.length]
                    );
                } else {
                    this._resetDrums();
                    this._idleDrums();
                }

                if (this[$synthPlayback]) {
                    this._playSynthNotes(
                        synthPattern[this[$synthPlayhead] % synthPattern.length]
                    );
                } else {
                    this._resetSynths();
                    this._idleSynths();
                }
            }

            if (this[$timer] === null) {
                this[$timer] = timestamp;
            }

            const frameTime = 1000.0 / 60.0;
            const progress = timestamp - this[$timer];
            if (progress + 2 * frameTime >= this[$stepDuration] * 1000.0) {
                this[$midi].noteTimestamp = this[$timer] + this[$stepDuration] * 1000.0;
                this[$noteScheduled] = true;

                this[$drumPlayhead] = ++this[$drumPlayhead] % drumPattern.length;
                this[$synthPlayhead] = ++this[$synthPlayhead] % synthPattern.length;
            }

            if (this[$playback]) {
                requestAnimationFrame(this._playBeat.bind(this));
            } else {
                this._resetDrums();
                this._idleDrums();

                this._resetSynths();
                this._idleSynths();
                this[$midi].noteTimestamp = 0;
                this[$timer] = null;
            }
        }

        _playSynthNotes(notes) {
            this._updatePatternUI();
            this._resetSynths();

            const notesArr = asArrayLike(notes);

            const midi = this[$midi];

            if (this[$activeSynthNotes] !== null) {
                midi.send(
                    this[$synthChannel],
                    'noteoff',
                    this[$activeSynthNotes][0],
                    127
                );
                if (this[$activeSynthNotes][1]) {
                    midi.send(
                        this[$synthChannel],
                        'noteoff',
                        this[$activeSynthNotes][1],
                        127
                    );
                }
            }

            if (notes !== null) {
                midi.send(this[$synthChannel], 'noteon', idxToMidi(notesArr[0]), 127);
                if (notesArr[1]) {
                    midi.send(this[$synthChannel], 'noteon', idxToMidi(notesArr[1]), 127);
                }
            } else {
                this[$activeSynthNotes] = null;
                return this._idleSynths();
            }

            // --- Tone.js synth playback ---
            if (notes !== null) {
                // Start Tone.js context on first user interaction if needed
                if (Tone.context.state !== 'running') {
                    Tone.start();
                }
                const midiNotes = notesArr.map(n => Tone.Frequency(idxToMidi(n), "midi").toNote());
                this._toneSynth.triggerAttackRelease(midiNotes, 0.3);
            }

            this[$activeSynthNotes] = [idxToMidi(notesArr[0])];
            if (notesArr[1]) {
                this[$activeSynthNotes].push(idxToMidi(notesArr[1]));
            }

            if (notesArr.length === 1) {
                const relNote = idxToMidi(notesArr[0]) % 12;
                if (relNote < 6) {
                    this._hide(SYNTH_IDLE_HAND_LEFT);
                    this._hitSynthKey(SYNTH_PLAY_HAND_LEFT, relNote);
                } else {
                    this._hide(SYNTH_IDLE_HAND_RIGHT);
                    this._hitSynthKey(SYNTH_PLAY_HAND_RIGHT, relNote);
                }
            } else {
                this._hide([SYNTH_IDLE_HAND_LEFT, SYNTH_IDLE_HAND_RIGHT]);
                const relNotesArr = [
                    idxToMidi(notesArr[0]) % 12,
                    idxToMidi(notesArr[1]) % 12
                ];
                this._hitSynthKey(SYNTH_PLAY_HAND_LEFT, Math.min(...relNotesArr));
                this._hitSynthKey(SYNTH_PLAY_HAND_RIGHT, Math.max(...relNotesArr));
            }
        }

        _hitSynthKey(hand, relNote) {
            if (!this[$synthKeyX]) {
                this[$synthKeyX] = [];
            }
            if (!this[$synthKeyX][0]) {
                this[$synthKeyX][0] = this.shadow
                    .querySelector('#bk0')
                    .getAttribute('x1');
            }
            if (!this[$synthKeyX][relNote]) {
                this[$synthKeyX][relNote] = this.shadow
                    .querySelector(`#bk${relNote}`)
                    .getAttribute('x1');
            }

            this._show(hand);

            const xDiff = this[$synthKeyX][relNote] - this[$synthKeyX][0];
            this.shadow
                .querySelector(hand)
                .style.setProperty('--translate-x', `${xDiff}px`);

            this._toggle([`#bk${relNote}`, hand], c.CLASS_HIT, true);

            this._toggle('#synthb', c.CLASS_FADED, false);
        }

        _playDrumNotes(notes) {
            this._updatePatternUI();
            this._resetDrums();

            const notesArr = asArrayLike(notes);

            const midi = this[$midi];

            if (this[$activeDrumNotes] !== null) {
                midi.send(this[$drumChannel], 'noteoff', this[$activeDrumNotes][0], 127);
                if (this[$activeDrumNotes][1]) {
                    midi.send(
                        this[$drumChannel],
                        'noteoff',
                        this[$activeDrumNotes][1],
                        127
                    );
                }
            }

            if (notes !== null) {
                midi.send(this[$drumChannel], 'noteon', idxToMidi(notesArr[0]), 127);
                if (notesArr[1]) {
                    midi.send(this[$drumChannel], 'noteon', idxToMidi(notesArr[1]), 127);
                }
            }

            // --- Tone.js drum playback ---
            if (notes !== null) {
                if (Tone.context.state !== 'running') {
                    Tone.start();
                }
                // Play each drum note as a short "kick" (can be improved for more realism)
                notesArr.forEach(n => {
                    this._toneDrum.triggerAttackRelease("C2", 0.15);
                });
            }

            if (notes === null) {
                this[$activeDrumNotes] = null;
                return this._idleDrums();
            }

            this[$activeDrumNotes] = [idxToMidi(notesArr[0])];
            if (notesArr[1]) {
                this[$activeDrumNotes].push(idxToMidi(notesArr[1]));
            }

            const note0 = drum[notesArr[0] % drum.length];
            const note1 = drum[notesArr[1] % drum.length] || note0;

            this._show(FACE(note0.face));

            const layer0 = note0.layer;
            this._show(layer0);
            this._toggle(layer0, c.CLASS_HIT, true);

            const hideLeftHand = !(
                note0.hands.includes(c.SIDE_LEFT) && note1.hands.includes(c.SIDE_LEFT)
            );
            this._toggle(DRUM_HAND_LEFT, c.CLASS_HIDDEN, hideLeftHand);

            const hideRightHand = !(
                note0.hands.includes(c.SIDE_RIGHT) && note1.hands.includes(c.SIDE_RIGHT)
            );
            this._toggle(DRUM_HAND_RIGHT, c.CLASS_HIDDEN, hideRightHand);

            const hideCowbell = note0.cowbell === false || note1.cowbell === false;
            this._toggle(COWBELL, c.CLASS_HIDDEN, hideCowbell);

            if (
                note0.hands === 'lr' ||
                note1.hands === 'lr' ||
                (note0.cowbell === false || note1.cowbell === false)
            ) {
                const layer1 = note1.layer;
                this._show(layer1);
                this._toggle(layer1, c.CLASS_HIT, true);
            }
        }

        // ...rest of the class unchanged...
        // (UI, MIDI, and utility methods)
    }

    customElements.define('finger-sequencer', Finger);
}

// --- Wait for DOMContentLoaded before running defineFingerSequencerWhenReady ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', defineFingerSequencerWhenReady);
} else {
    defineFingerSequencerWhenReady();
}