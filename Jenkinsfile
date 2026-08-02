// Jenkinsfile — webhook / SCM trigger restarts Point Poker on the host via pm2.
// Do NOT run `npm run dev` as a long-lived Jenkins stage (job would kill it on exit).
//
// This Jenkins (2.568.x) has: upstream, cron, githubPush, pollSCM
// — no Generic Webhook Trigger plugin, so we use githubPush.
//
// Setup (once on agent3):
//   1. Permanent checkout: ~/apps/trueid-point-poker (+ server/.env)
//   2. Job: Pipeline from SCM → https://github.com/SebberSky/trueid-point-poker
//      Branch */main · Script Path: Jenkinsfile · agent label: agent3
//   3. GitHub repo → Settings → Webhooks → Add webhook:
//      Payload URL: http://<JENKINS_URL>/github-webhook/
//      Content type: application/json
//      Events: Just the push event
//   4. Or Build Now manually anytime

pipeline {
  agent { label 'agent3' }

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  triggers {
    githubPush()
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Restart point-poker (pm2)') {
      steps {
        sh '''
          export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
          chmod +x scripts/jenkins-restart.sh
          bash scripts/jenkins-restart.sh
        '''
      }
    }
  }

  post {
    success {
      echo 'Point Poker restarted via pm2. Local: http://localhost:5174/  API: :3002'
    }
    failure {
      echo 'Restart failed — check Node/pm2 on the agent and port 5174/3002.'
    }
  }
}
