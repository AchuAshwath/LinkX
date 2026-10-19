import AppKit
import Foundation
import Vision

struct Result: Encodable {
  let file: String
  let level: String
  let languageCorrection: Bool
  let elapsedMs: Double
  let recognizedLines: [String]
  let confidence: [Float]
}

let args = Array(CommandLine.arguments.dropFirst())
let level = args.first == "fast" ? VNRequestTextRecognitionLevel.fast : .accurate
let levelName = args.first == "fast" ? "fast" : "accurate"
let correction = args.dropFirst().first != "raw"
var output: [Result] = []
for file in args.dropFirst(2) {
  guard let image = NSImage(contentsOfFile: file),
        let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("Could not load image: \(file)\n", stderr)
    exit(2)
  }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = level
  request.recognitionLanguages = ["en-US"]
  request.usesLanguageCorrection = correction
  let start = DispatchTime.now().uptimeNanoseconds
  try VNImageRequestHandler(cgImage: cgImage).perform([request])
  let elapsed = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
  let observations = (request.results ?? []).sorted { $0.boundingBox.midY > $1.boundingBox.midY }
  output.append(Result(
    file: URL(fileURLWithPath: file).lastPathComponent,
    level: levelName,
    languageCorrection: correction,
    elapsedMs: elapsed,
    recognizedLines: observations.compactMap { $0.topCandidates(1).first?.string },
    confidence: observations.compactMap { $0.topCandidates(1).first?.confidence }
  ))
}
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
FileHandle.standardOutput.write(try encoder.encode(output))
