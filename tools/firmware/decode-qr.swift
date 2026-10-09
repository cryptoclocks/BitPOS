import Foundation
import Vision
import ImageIO
if CommandLine.arguments.count != 2 { fatalError("Usage: swift decode-qr.swift <frame.png>") }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fatalError("Cannot decode image") }
let request = VNDetectBarcodesRequest()
request.symbologies = [.qr]
try VNImageRequestHandler(cgImage: image).perform([request])
let payloads = (request.results ?? []).compactMap { $0.payloadStringValue }
guard payloads.count == 1 else { fatalError("Expected exactly one QR payload") }
let evidence: [String: Any] = ["origin":"macOS_Vision_decoding_actual_supplied_framebuffer_image", "image":CommandLine.arguments[1], "payloads":payloads, "physical_camera_or_phone_claim":false]
let data = try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys])
print(String(data:data,encoding:.utf8)!)
