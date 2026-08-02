// Jenkinsfile — webhook / SCM trigger restarts Point Poker on the host via pm2.
// Do NOT run `npm run dev` as a long-lived Jenkins stage (job would kill it on exit).
//
// Setup (once on agent3 Jenkins agent):
//   1. Node + npm installed
//   2. Permanent checkout at ~/apps/trueid-point-poker (+ server/.env)
//   3. Agent label below matches this machine (change if needed)
//   4. Job: Pipeline from SCM → https://github.com/SebberSky/trueid-point-poker
//      Script Path: Jenkinsfile
//   5. Build once (manual) so the GenericTrigger token is registered
//   6. Webhook URL (Jenkins 2.5xx / Generic Webhook Trigger):
//      http://<JENKINS_URL>/generic-webhook-trigger/invoke?token=trueid-point-poker

pipeline {
  agent { label 'agent3' }

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  // Token lives here — Jenkins 2.5xx job UI often has no Token field for Pipeline-from-SCM.
  // After first successful run, Configure → Build Triggers will show Generic Webhook Trigger checked.
  triggers {
    GenericTrigger(
      token: 'trueid-point-poker',
      causeString: 'Generic webhook for trueid-point-poker',
      printContributedVariables: false,
      printPostContent: false,
      silentResponse: false
    )
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Restart point-poker (pm2)') {
      steps {
        sh 'chmod +x scripts/jenkins-restart.sh'
        sh 'bash scripts/jenkins-restart.sh'
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
