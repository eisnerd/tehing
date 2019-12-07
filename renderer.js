// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

const $ = require("jquery");
const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const util = require('util');
const matchAll = require('string.prototype.matchall').shim();
const {Howl, Howler} = require('howler');
const textToSpeech = require('@google-cloud/text-to-speech');
const speech = new textToSpeech.TextToSpeechClient();
const DataURI = require('datauri');
const datauri = new DataURI();

const WordPOS = require('wordpos');
const wordpos = new WordPOS();

let r_phoneme = /tmcore_assets_phonics_phonemes_phoneme_angela_(.*)_ogg.ogg/;
let r_word = /tmcore_assets_phonics_words_audio_(.*)_ogg.ogg/;
let phonemes = window.phonemes = {};
let words = window.words = {}
let synth = window.synth = {}
let alternatives = {
  'n': ["kn", "gn"],
  'm': ["mb", "mn"],
  'd': ["ed"],
  'g': ["\\bgh"],
  'l': ["ll"],
  'f': ["ff", "ph", "\\Bgh"],
  'j': ["\\bg(?=[eiy])", "dge", "\\Bge"],
  'oa': ["o\\we", "ow", "\\Bo", "oe", "ough", "eau", "ou"],
  'ee': ["e\\we", "y", "ea", "ie", "ey", "\\Be$", "\\Bae$"],
  'ai': ["a\\we", "ay", "ei", "eigh", "ey", "ae", "ea"],
  'ie': ["i\\we", "igh", "\\By$", "\\bei", "\\bai", "\\Bye", "uy"],
  'or': ["al", "au", "aw", "ore", "ough", "ar", "oar", "our", "oor"],
  'z': ["\\Bs$", "\\Bse$", "ze"],
  'v': ["ve"],
  'oo': ["ue", "u\\we", "ew", "\\bu$", "\\bo$", "ui", "ou", "ough", "eu"],
  'w': ["wh", "ui"],
  'ch': ["tch"],
  'sh': ["sch", "\\Bche$", "\\Bci", "\\Bti", "\\Bsi"],
  'ou': ["ow", "ough"],
  'oi': ["oy", "uoy"],
  'ue': ["u\\we", "ew", "\\bu", "eu"],
  'ur': ["ir", "er", "ear", "or", "our", "re"],
  'ar': ['ear', 'al', '\\bau'],
  'air': ['\\Bare', '\\Bear', '\\Bere', 'aer'],
  'zh': ["\\Bsi", "\\Bs\\B", "\\Bg\\B", "\\Bge$"],
  'ool': ["\\Ble", "\\Bal$", "\\Bil$", "\\Bol$", "\\Bul"]
};
let res = path.join(path.dirname(process.mainModule.filename), "res", "raw");
_.each(fs.readdirSync(res), f => {
  let sound = () => new Howl({
    src: path.join(res, f)
  });
  var match = r_phoneme.exec(f);
  if (match) {
    let s = sound();
    _.each((alternatives[match[1]] || []).concat([match[1]]), phoneme => {
      if (!phonemes[phoneme] || phoneme == match[1]) {
        phonemes[phoneme] = {
          r: new RegExp("^" + phoneme + "$"),
          spelling: phoneme.replace(/[.]|\\w/g, "_").replace(/\\.|\(.*\)|\[.*\]|\W/g, ""),
          sound: s
        };
      }
    });
    return;
  }
  match = r_word.exec(f);
  if (match) {
    words[match[1]] = sound();
    return;
  }
});
let r_phonemes = new RegExp("(" + _.keys(phonemes).join("|") + ")$");
_.each(phonemes, p => {
  if (!phonemes[p.spelling])
    phonemes[p.spelling] = p;
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
let play = util.promisify(async function(sound, cont) {
  if (sound)
    sound.on('end', () => {
      sound.off('end');
      cont();
    }).play();
  else
    cont();
});

let display = $('.display');

var goal = "";
let feedqueue = [];
var feedthrottle = 0;
let feedpause = true;
let synthesize = async x => {
  var sound = synth[x];
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
  return sound;
};
let feedproc = async () => {
  const now = Date.now();
  let remaining = 1000 - now + feedthrottle;
  if (remaining > 0)
    await sleep(remaining);
  feedthrottle = now;

  let next = feedqueue.pop();
  if (next) {
    if (!_.isObject(next))
      next = {text: next, say: next};
    if (next.action == "repeat")
      next.say = goal;
    if (next.delay)
      await sleep(next.delay*1000);

    display.text(next.text);
    let x = next.say;

    if (next.action != "repeat" && x && goal == x.trim()) {
      feedqueue.push({play: "res/raw/tm2_assets_audio_phonics_narr_yesyoumadetheword_ogg.ogg", say: x});
      goal = "";
    }

    if (next.play) {
      await play(new Howl({src: next.play}));
    }

    var sound = undefined;
    if (x) {
      let y = x;
      x = x.trim();
      if (x != y || x.length > 2)
        sound = words[x];
      if (!sound) {
        sound = phonemes[x];
        if (sound)
          sound = sound.sound;
        else
          sound = words[x];
          if (!sound)
        sound = await synthesize(x);
      }
      await play(sound);
    }
    feedproc();
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

function logfile() {
  fs.mkdir("log", e => e && e.code != "EEXIST" && console.log(e))
  return "log/" + new Date().toISOString().split('T')[0] + ".txt";
}

function show_log(txt) {
  $("<p/>")
    .prependTo($('.log'))
    .text(txt);
}

fs.readFile(logfile(), (err, data) => {
  if (data) {
    for (const line of data.toString().matchAll(/(?<=^|[\r\n])[^\r\n]+(?=$|[\r\n][\r\n])/g))
      if (line[0].length + line.index == line.input.length)
        $('[contenteditable]')
          .first().text(line[0])
          .each(function() { // move the caret to the end
            var range = document.createRange();
            range.setStart(this, 1);
            range.collapse(false);
            var selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
          });
      else
        show_log(line[0]);
  }
});

function log(txt, cont) {
  let file = logfile();
  fs.readFile(file, (err, data) => {
    if (err && err.code != "ENOENT") // create if not exists
      throw err;

    let doc = (data || "").toString();
    let line = doc.replace(/(.|\s)*[\r\n]+/, "");
    if (txt.length >= line.length && txt.slice(0, line.length) == line)
      doc = doc.slice(0, doc.length - line.length);
    else
      doc += "\n";

    fs.writeFile(file, doc + txt, err => {
      if (err)
        throw err;
      if (cont)
        cont();
    });
  });
}

$('[contenteditable]')
  .first().focus()
  .blur(e => {
    e.target.focus();
  })
  .keydown((e) => {
    //console.log(e);
    let button = $('[data-key="' + e.key + '"]');
    if (button.length) {
      button.click();
      return false;
    } else if (/\w/.test(String.fromCharCode(e.keyCode))) {
      let m = r_phonemes.exec($(e.target).text() + e.key);
      if (m) {
        var phoneme = phonemes[m[1]];
        if (!phoneme)
          phoneme = _.find(phonemes, p => p.r.test(m[1]));
        if (phoneme)
          feed(phoneme.spelling);
        else
          feed(m[1]);
      } else
        feed(e.key);
    } else if (/^[\r\n]+$/.test(String.fromCharCode(e.keyCode))) {
      let txt = $(e.target).text().trim();

      show_log(txt);
      log(txt + "\n\n", () => $(e.target).text(''));

      return false;
    } else if (/^\s+$/.test(String.fromCharCode(e.keyCode))) {
      let txt = $(e.target).text();
      log(txt.trim());
      let y = /(\S*)\s*$/.exec(txt)[1];
      if (y)
        feed(y + " ");

      return e.keyCode == 32 && !/\s+$/.test(txt);
    }
  });

$('.repeat').click(() => {
  feed({action: "repeat"});
});

$('.cue').click(() => {
  let w = _.filter(_.keys(words), word => word.length == 3);
  goal = w[_.random(0, w.length)];
  feedqueue.unshift({action: "repeat", text: goal});
  feed({delay: 2, text: ""});
});

let colour_active = false;
let colour_btn = $('.colour').click(() => {
  colour_active = !colour_active;
})
const color = require('color');
var hue = 0;
setInterval(() => {
  if (colour_active) {
    $('html, span').attr('style', 'color: ' + (hue > 360 ? 'white;' : 'hsl(' + hue + ', 100%, 70%) !important;'));
    hue = (hue + 5) % 400;
  }
}, 200);
