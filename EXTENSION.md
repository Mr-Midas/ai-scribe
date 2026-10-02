# Note Scribe AI Chrome extension

The extension is a small popup in Chrome that does the same thing as the [web app](README.md#using-the-web-app-clinicians): paste shorthand notes, get a SOAP note, copy it. Most users should use the web app instead, since it needs no installation.

> **Not HIPAA compliant yet.** The extension sends notes to the Note Scribe cloud service, which is in a pilot. See [Path to HIPAA compliance](README.md#path-to-hipaa-compliance). Do not enter patient-identifying information.

## How it works

- Notes are sent over HTTPS to the Note Scribe API (`https://note-scribe-ai-api.thomelfin529.workers.dev`), which writes and checks the note. The extension does **not** run an AI model on your computer.
- Each user enters their own access key in the popup. No key is built into the extension.
- The extension saves only your access key, note type and EHR choice. Note text is not saved, and text saved by versions before 1.2.0 is deleted when the popup opens.

## Install (developer mode)

1. Download this repository (green **Code** button on GitHub, then **Download ZIP**) and unzip it.
2. In Chrome, go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.
4. Click the puzzle-piece icon in Chrome's toolbar and pin **Note Scribe AI**.
5. Open the popup and enter your access key in the **Access Key** field.

## Use

1. Choose **Initial Evaluation** or **Treatment / Re-eval**.
2. Type your notes, choose your EHR if listed, and click **Generate**. `Ctrl+Enter` (Windows) or `Cmd+Enter` (Mac) also works.
3. If the popup says **Needs your review**, the note contains details you did not write; correct or delete them.
4. Click **Copy** and paste into your EHR.

## Legacy local-AI code

The earlier version that ran an AI model locally with Ollama (its service worker, setup scripts and guides) is archived in the private repository [Mr-Midas/ai-scribe-ollama-legacy](https://github.com/Mr-Midas/ai-scribe-ollama-legacy).
