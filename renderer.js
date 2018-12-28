// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

const $ = require("jquery");
const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const {Howl, Howler} = require('howler');
const textToSpeech = require('@google-cloud/text-to-speech');
const speech = new textToSpeech.TextToSpeechClient();
const DataURI = require('datauri');
const datauri = new DataURI();

let r_phoneme = /tmcore_assets_phonics_phonemes_phoneme_angela_(.*)_ogg.ogg/;
let r_word = /tmcore_assets_phonics_words_audio_(.*)_ogg.ogg/;
let phonemes = window.phonemes = {};
let words = window.words = {}
let synth = window.synth = {}
let res = path.join(path.dirname(process.mainModule.filename), "res", "raw");
_.each(fs.readdirSync(res), f => {
  let sound = () => new Howl({
    src: path.join(res, f)
  });
  var match = r_phoneme.exec(f);
  if (match) {
    phonemes[match[1]] = sound();
    return;
  }
  match = r_word.exec(f);
  if (match) {
    words[match[1]] = sound();
    return;
  }
});
let r_phonemes = new RegExp("(" + _.keys(phonemes).join("|") + ")$");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
async function play(sound, cont) {
  if (sound)
    sound.on('end', () => {
      console.log('end');
      sound.off('end');
      cont();
    }).play();
  else
    cont();
}

let display = $('.display');

let feedqueue = [];
var feedthrottle = 0;
let feedpause = true;
let feedproc = async () => {
  const now = Date.now();
  let remaining = 1000 - now + feedthrottle;
  if (remaining > 0)
    await sleep(remaining);
  feedthrottle = now;

  let x = feedqueue.pop();
  if (x) {
    display.text(x);
    var sound;
    if (sound = phonemes[x])
      play(sound, feedproc);
    else if (sound = words[x])
      play(sound, feedproc);
    else {
      sound = synth[x];
      if (!sound) {
        console.log("No sound for '${x}'");
        const [response] = await speech.synthesizeSpeech({
            input: {text: x},
            voice: {languageCode: 'en-GB', ssmlGender: 'NEUTRAL'},
            audioConfig: {audioEncoding: 'MP3'},
          });
        sound = synth[x] = new Howl({
          src: datauri.format('.mp3', response.audioContent).content
        });
      }
      play(sound, feedproc);
    }
  } else {
    //display.text("");
    feedpause = true;
  }
};

let feed = (x) => {
  feedqueue.unshift(x);
  if (feedpause) {
    feedpause = false;
    feedproc();
  }
}

$('[contenteditable]')
  .first().focus()
  .keydown((e) => {
    //console.log(e);
    if (/\w/.test(String.fromCharCode(e.keyCode))) {
      let m = r_phonemes.exec($(e.target).text() + e.key);
      if (m)
        feed(m[1]);
      else
        feed(e.key);
    } else if (/^\s+$/.test(String.fromCharCode(e.keyCode))) {
      let txt = $(e.target).text();
      let y = /(\S*)\s*$/.exec(txt)[1];
      if (y)
        feed(y);

      return e.keyCode == 32 && !/\s+$/.test(txt);
    }
  })
