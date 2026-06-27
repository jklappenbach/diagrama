package dev.diagrama.intellij

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.beans.PropertyChangeListener
import javax.swing.JComponent

/**
 * The preview half: a JCEF browser running the diagrama renderer core. The JVM pushes
 * the document text in (text edit -> re-render); the browser posts a drag back out
 * (drag -> minimal `pos` write-back into the Document). One core, both directions.
 */
class DiagramaPreviewFileEditor(
    private val project: Project,
    private val file: VirtualFile,
) : UserDataHolderBase(), FileEditor {

    private val browser = JBCefBrowser()
    private val document: Document? = FileDocumentManager.getInstance().getDocument(file)
    private val persistQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private var ready = false

    private val docListener = object : DocumentListener {
        override fun documentChanged(event: DocumentEvent) = pushContent()
    }

    init {
        // drag in the preview -> JS calls window.__diagramaPersist(text) -> here.
        persistQuery.addHandler { newText ->
            ApplicationManager.getApplication().invokeLater {
                if (document != null && document.text != newText) {
                    WriteCommandAction.runWriteCommandAction(project) { document.setText(newText) }
                }
            }
            null
        }

        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(b: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                if (ready) return
                ready = true
                injectBridge()
                pushContent()
            }
        }, browser.cefBrowser)

        browser.loadHTML(Html.page())
        document?.addDocumentListener(docListener)
    }

    private fun injectBridge() {
        val js = "window.__diagramaPersist = function(text){ ${persistQuery.inject("text")} };"
        browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0)
    }

    private fun pushContent() {
        if (!ready) return
        val text = document?.text ?: return
        val js = "window.diagrama && window.diagrama.setContent(${Html.jsString(text)}, ${Html.jsString(file.name)});"
        browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0)
    }

    override fun getComponent(): JComponent = browser.component
    override fun getPreferredFocusedComponent(): JComponent = browser.component
    override fun getName(): String = "Preview"
    override fun setState(state: FileEditorState) {}
    override fun isModified(): Boolean = false
    override fun isValid(): Boolean = true
    override fun addPropertyChangeListener(listener: PropertyChangeListener) {}
    override fun removePropertyChangeListener(listener: PropertyChangeListener) {}
    override fun getFile(): VirtualFile = file

    override fun dispose() {
        document?.removeDocumentListener(docListener)
        persistQuery.dispose()
        browser.dispose()
    }
}
