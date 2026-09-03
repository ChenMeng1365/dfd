' dfd hub - hidden launcher
' Runs "node server.js" in a hidden window, output goes to server.log
' Port is passed via PORT env var (same behavior as original start.bat)
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

port = ""
If WScript.Arguments.Count > 0 Then port = Trim(WScript.Arguments(0))
If port <> "" Then sh.Environment("PROCESS")("PORT") = port

Set lf = fso.OpenTextFile(dir & "\server.log", 8, True)
lf.WriteLine Now & " starting dfd hub (hidden), PORT=" & port
lf.Close

sh.Run "cmd /c node server.js >> server.log 2>&1", 0, False
