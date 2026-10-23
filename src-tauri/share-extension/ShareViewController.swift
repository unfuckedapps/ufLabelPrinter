import AppKit
import UniformTypeIdentifiers

/// "Share → ufLabelPrinter": hands the shared PDFs to the app, which opens them like files
/// from "Open With". There is no UI; the sheet closes as soon as the app has them.
@objc(ShareViewController)
final class ShareViewController: NSViewController {
    override var nibName: NSNib.Name? { nil }

    override func loadView() {
        view = NSView(frame: .zero)
    }

    override func beginRequest(with context: NSExtensionContext) {
        super.beginRequest(with: context)
        let providers = context.inputItems
            .compactMap { $0 as? NSExtensionItem }
            .flatMap { $0.attachments ?? [] }

        let group = DispatchGroup()
        var files = [URL?](repeating: nil, count: providers.count)
        for (index, provider) in providers.enumerated() {
            group.enter()
            Self.file(from: provider) { url in
                DispatchQueue.main.async {
                    files[index] = url
                    group.leave()
                }
            }
        }
        group.notify(queue: .main) {
            Self.open(files.compactMap { $0 }, context: context)
        }
    }

    /// The shared file itself when the host passes one (Finder, Preview), so the app shows
    /// its real name; otherwise a copy of the data.
    private static func file(from provider: NSItemProvider, done: @escaping (URL?) -> Void) {
        // Only PDFs: Launch Services opens just the types the app claims (tauri.conf.json).
        guard provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) else {
            return done(nil)
        }
        guard provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) else {
            return copy(from: provider, done: done)
        }
        _ = provider.loadObject(ofClass: URL.self) { url, _ in
            if let url, url.isFileURL {
                done(url)
            } else {
                copy(from: provider, done: done)
            }
        }
    }

    /// The host's file is temporary and gone once the handler returns, so keep a copy.
    private static func copy(from provider: NSItemProvider, done: @escaping (URL?) -> Void) {
        provider.loadFileRepresentation(forTypeIdentifier: UTType.pdf.identifier) { url, _ in
            guard let url else { return done(nil) }
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            // The temporary file has a generated name; the app shows the file name as title.
            var name = (provider.suggestedName ?? "").replacingOccurrences(of: "/", with: "-")
            if name.isEmpty { name = "Shared" }
            if (name as NSString).pathExtension.lowercased() != "pdf" {
                name += ".pdf"
            }
            let copy = dir.appendingPathComponent(name)
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try FileManager.default.copyItem(at: url, to: copy)
                done(copy)
            } catch {
                NSLog("ufLabelPrinter share: could not copy %@: %@", url.path, error.localizedDescription)
                done(nil)
            }
        }
    }

    private static func open(_ files: [URL], context: NSExtensionContext) {
        guard !files.isEmpty else {
            return context.cancelRequest(withError: CocoaError(.fileReadUnsupportedScheme))
        }
        // …/ufLabelPrinter.app/Contents/PlugIns/ShareExtension.appex
        let app = Bundle.main.bundleURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        NSWorkspace.shared.open(files, withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration()) { _, error in
            DispatchQueue.main.async {
                if let error {
                    NSLog("ufLabelPrinter share: could not open %@: %@", app.path, error.localizedDescription)
                    context.cancelRequest(withError: error)
                } else {
                    context.completeRequest(returningItems: nil)
                }
            }
        }
    }
}
