import { readFile, writeFile } from 'node:fs/promises'

const podfilePath = new URL('../ios/App/Podfile', import.meta.url)
const scannerPod = "  pod 'CapacitorMlkitBarcodeScanning', :path => '../../node_modules/@capacitor-mlkit/barcode-scanning'\n"
const podfile = await readFile(podfilePath, 'utf8')
const occurrences = podfile.split(scannerPod).length - 1
if (occurrences !== 1) {
  throw new Error(`Expected exactly one ML Kit barcode scanner pod entry, found ${occurrences}`)
}
await writeFile(podfilePath, podfile.replace(scannerPod, ''))
console.log('Prepared iOS Simulator pods without the device-camera ML Kit dependency')
