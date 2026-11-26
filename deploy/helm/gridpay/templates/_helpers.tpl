{{- define "gridpay.labels" -}}
app.kubernetes.io/part-of: gridpay
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
