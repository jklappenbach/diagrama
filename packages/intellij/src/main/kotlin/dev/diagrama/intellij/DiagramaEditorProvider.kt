package dev.diagrama.intellij

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.fileEditor.TextEditorWithPreview
import com.intellij.openapi.fileEditor.impl.text.PsiAwareTextEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/**
 * Opens *.diagrama.kdl as a [ host text editor | JCEF diagrama preview ] split — the
 * built-in Markdown plugin's shape. The text half is the normal editor (KDL syntax via
 * the separately-installed intellij-kdl plugin); the preview half runs the core bundle.
 */
class DiagramaEditorProvider : FileEditorProvider, DumbAware {

    override fun accept(project: Project, file: VirtualFile): Boolean =
        file.name.endsWith(".diagrama.kdl")

    override fun createEditor(project: Project, file: VirtualFile): FileEditor {
        val textEditor = PsiAwareTextEditorProvider().createEditor(project, file) as TextEditor
        val preview = DiagramaPreviewFileEditor(project, file)
        return TextEditorWithPreview(
            textEditor, preview, "diagrama",
            TextEditorWithPreview.Layout.SHOW_EDITOR_AND_PREVIEW,
        )
    }

    override fun getEditorTypeId(): String = "diagrama-preview"

    // Keep the plain text editor available too, but default to our split.
    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR
}
