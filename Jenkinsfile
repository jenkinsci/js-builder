pipeline {
  agent { docker 'node:6.11.2-alpine' }
  stages {
    stage('build') {
      steps {
        checkout scm
        sh 'npm install'
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