'use strict'

const { writeFileSync } = require('fs')
const { join } = require('path')
const { setFlagsFromString } = require('v8')
const { runInNewContext } = require('vm')

const isHtmlContent = require('..')

const RUNS = 7
const MIXED_ROUNDS = 20000
const PADDED_CHECKS = 1600
const PADDING_BYTES = 64 * 1024

const HTML_SAMPLES = [
  '<!DOCTYPE html><html><head><title>page</title></head><body></body></html>',
  '\n\n  <html lang="en"><body><p>hello</p></body></html>',
  '\t<div class="card">content</div>',
  '\r\n<?xml version="1.0"?><rss></rss>'
]

const TEXT_SAMPLES = [
  '{"type":"json","html":"<b>not html</b>"}',
  'plain text that mentions <html> later on',
  '   hello world',
  ''
]

const mixedInputs = Array.from({ length: 512 }, (_, index) => {
  const pool = index % 2 === 0 ? HTML_SAMPLES : TEXT_SAMPLES
  return pool[(index >> 1) % pool.length] + ' '.repeat(index % 7)
})

const expectedHtml = mixedInputs.filter((_, index) => index % 2 === 0).length

const padding = ' \n\t'
  .repeat(Math.ceil(PADDING_BYTES / 3))
  .slice(0, PADDING_BYTES)
const paddedHtml = `${padding}<html></html>`
const paddedText = `${padding}text`

const mixedCase = {
  name: 'detect mixed short inputs',
  extra: `${MIXED_ROUNDS} rounds over ${mixedInputs.length} inputs`,
  timed: () => {
    let html = 0
    for (let round = 0; round < MIXED_ROUNDS; round++) {
      for (const input of mixedInputs) {
        if (isHtmlContent(input)) html++
      }
    }
    return html
  },
  verify: html => html === MIXED_ROUNDS * expectedHtml
}

const paddedCase = {
  name: 'scan 64KB leading whitespace',
  extra: `${PADDED_CHECKS} html and ${PADDED_CHECKS} text checks`,
  timed: () => {
    let correct = 0
    for (let check = 0; check < PADDED_CHECKS; check++) {
      if (isHtmlContent(paddedHtml)) correct++
      if (!isHtmlContent(paddedText)) correct++
    }
    return correct
  },
  verify: correct => correct === PADDED_CHECKS * 2
}

const CASES = [mixedCase, paddedCase]

const median = values => {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

setFlagsFromString('--expose-gc')
const collectGarbage = runInNewContext('gc')

const now = () => process.hrtime.bigint()

const elapsed = started => Number(now() - started) / 1e6

const fmt = value => value.toFixed(1)

const report = slot => {
  const med = slot.walls.length ? median(slot.walls) : Number.NaN
  const min = slot.walls.length ? Math.min(...slot.walls) : Number.NaN
  const max = slot.walls.length ? Math.max(...slot.walls) : Number.NaN
  const extra = `${slot.entry.extra}, errors ${slot.errors}, runs ${RUNS}`
  console.log(
    `${slot.entry.name}  median ${fmt(med)}ms  range ${fmt(min)}-${fmt(
      max
    )}  ${extra}`
  )
  return {
    name: slot.entry.name,
    unit: 'ms',
    value: Number(med.toFixed(1)),
    range: `${fmt(min)}-${fmt(max)}`,
    extra
  }
}

const takeSample = (slot, run) => {
  try {
    collectGarbage()
    const started = now()
    const outcome = slot.entry.timed()
    const wall = elapsed(started)
    if (!slot.entry.verify(outcome)) {
      console.error(`${slot.entry.name} run ${run} produced unexpected output`)
      slot.errors++
      return
    }
    slot.walls.push(wall)
  } catch (error) {
    console.error(error)
    slot.errors++
  }
}

const main = () => {
  const slots = CASES.map(entry => ({ entry, walls: [], errors: 0 }))
  for (const slot of slots) {
    try {
      slot.entry.timed()
    } catch (error) {
      console.error(error)
      slot.errors++
    }
  }
  for (let run = 0; run < RUNS; run++) {
    for (const slot of slots) takeSample(slot, run)
  }
  const results = slots.map(report)
  writeFileSync(
    join(__dirname, '..', 'benchmark-output.json'),
    JSON.stringify(results, null, 2) + '\n'
  )
  const errors = slots.reduce((total, slot) => total + slot.errors, 0)
  if (errors > 0 || results.some(result => !Number.isFinite(result.value))) {
    process.exitCode = 1
  }
}

main()
