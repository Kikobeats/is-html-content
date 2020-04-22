'use strict'

const test = require('ava')

const isHtml = require('..')

test('false', t => {
  t.false(isHtml('category,name,title,type,score'))
})

test('true', t => {
  t.true(
    isHtml(`


    <!DOCTYPE html>
  `)
  )
  t.true(isHtml('<'))
})
