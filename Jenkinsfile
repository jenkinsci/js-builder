pipeline {
  agent { docker 'node:6.11.2-alpine' }
  stages {
    stage('build') {
      steps {
        sh 'npm run build'
      }
    }
  }
  post {
    always {
      junit 'target/surefire-reports/JasmineReport.xml'
    }
  }
}