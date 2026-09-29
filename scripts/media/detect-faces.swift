import Foundation
import Vision
import ImageIO

struct FacePoint: Codable {
    let time: Double
    let centerX: Double
    let confidence: Float
    let width: Double
}

guard CommandLine.arguments.count == 3, let interval = Double(CommandLine.arguments[2]), interval > 0 else {
    FileHandle.standardError.write(Data("Usage: detect-faces.swift <frames-directory> <interval>\n".utf8))
    exit(2)
}

let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
    .filter { $0.pathExtension.lowercased() == "jpg" }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }
var points: [FacePoint] = []

for (index, file) in files.enumerated() {
    try autoreleasepool {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return }
        let request = VNDetectFaceRectanglesRequest()
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        try handler.perform([request])
        guard let face = request.results?.max(by: { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }) else { return }
        points.append(FacePoint(
            time: Double(index) * interval,
            centerX: face.boundingBox.midX,
            confidence: face.confidence,
            width: face.boundingBox.width
        ))
    }
}

let encoder = JSONEncoder()
FileHandle.standardOutput.write(try encoder.encode(points))
FileHandle.standardOutput.write(Data("\n".utf8))
