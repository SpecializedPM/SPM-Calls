const teamMappings = [
    {
        team_name: 'Sales',
        manager: 'aaron@specialized247.com',
        supervisors: [ ],
        subteams: { },
        users: [
            'aaron@specialized247.com',
            'glizardo@specialized247.com',
            'sarah@specialized247.com'
        ]
    },

    {
        team_name: 'Concierge',
        manager: 'kyle@specialized247.com',
        supervisors: [ 'darleen@specialized247.com' ],
        subteams: { },        
        users: [
            'ahuizar@specialized247.com',
            'ana@specialized247.com',
            'april@specialized247.com',
            'darleen@specialized247.com',
            'jericson@specialized247.com',
            'joaquin@specialized247.com',
            'mira@specialized247.com'
        ]
    },

    {
        team_name: 'Leasing',
        manager: 'lilly@specialized247.com',
        supervisors: [ 'stewart@specialized247.com' ],
        subteams: {
            leasing_coordinators: [
                'liz@specialized247.com',
                'lynne@specialized247.com',
                'sandra@specialized247.com',
                'tatiana@specialized247.com'
            ],

            leasing_support: [
                'arleth@specialized247.com',
                'enrique@specialized247.com',
                'jsuba@specialized247.com',
                'nicole@specialized247.com'
            ],

            leasing_agents: [
                'dorian@specialized247.com',
                'garrett@specialized247.com',
                'jacob@specialized247.com',
                'nancy@specialized247.com',
                'stewart@specialized247.com'
            ],

            renewals: [
                'ronalyn@specialized247.com'
            ]
        },   
        users: [
        'arleth@specialized247.com',
        'dorian@specialized247.com',
        'enrique@specialized247.com',
        'garrett@specialized247.com',
        'jacob@specialized247.com',
        'jsuba@specialized247.com',
        'liz@specialized247.com',
        'lynne@specialized247.com',
        'nancy@specialized247.com',
        'nicole@specialized247.com',
        'ronalyn@specialized247.com',
        'sandra@specialized247.com',
        'stewart@specialized247.com',
        'tatiana@specialized247.com'
        ]
    },

    {
        team_name: 'Maintenance',
        manager: 'alejandro@specialized247.com',
        supervisors: [
            'seantel@specialized247.com',
            'romulo@specialized247.com',
            ],
        subteams: { }, 
        users: [
            'aleida@specialized247.com',
            'alejandro@specialized247.com',
            'alfredo@specialized247.com',
            'cesparza@specialized247.com',
            'gemma@specialized247.com',
            'george@specialized247.com',
            'gerardo@specialized247.com',
            'gustavo@specialized247.com',
            'javier@specialized247.com',
            'jessica@specialized247.com',
            'jsanchez@specialized247.com',
            'john@specialized247.com',
            'jkurek@specialized247.com',
            'romulo@specialized247.com',
            'seantel@specialized247.com'
        ]
    },
    {
        team_name: 'Rent Collections',
        manager: 'debbie@specialized247.com',
        supervisors: [ ],
        subteams: { }, 
        users: [
            'debbie@specialized247.com',
            'ica@specialized247.com',
            'mariana@specialized247.com',
            'tina@specialized247.com'
        ]
    },
    {
        team_name: 'Asset Management',
        manager: 'jennifer@specialized247.com',
        supervisors: [ ],
        subteams: { }, 
        users: [
            'evan@specialized247.com',
            'jennifer@specialized247.com',
            'glenda@specialized247.com',
            'marco@specialized247.com',
            'mariano@specialized247.com',
            'nena@specialized247.com',
            'nick@specialized247.com',
            'nino@specialized247.com'
        ]
    },
    {
        team_name: 'Internal Accounting',
        manager: 'kim@specialized247.com',
        supervisors: [ 'jamee@specialized247.com' ],
        subteams: { },
        users: [
            'jamee@specialized247.com',
            'kim@specialized247.com',
            'kristin@specialized247.com',
            'marie@specialized247.com',
            'nica@specialized247.com'
        ]
    },
    {
        team_name: 'Field Assessors',
        manager: 'jeremy@specialized247.com',
        supervisors: [ 'jeremy@specialized247.com' ],
        subteams: { },
        users: [
            'jeremy@specialized247.com',
            'gideon@specialized247.com',
            'jonathan@specialized247.com',
            'jorge@specialized247.com',
            'larry@specialized247.com',
            'ralph@specialized247.com',
            'rick@specialized247.com',
            'tiana@specialized247.com',
            'wil@specialized247.com'
        ]
    },
    {
        team_name: 'Client Onboarding',
        manager: 'kmoore@specialized247.com',
        supervisors: [ 'sergio@specialized247.com' ],
        subteams: {
            client_coordinators: [
                'sergio@specialized247.com',
                'ecampos@specialized247.com',
                'glizardo@specialized247.com'
            ],
            utilities: [
                'catherine@specialized247.com',
                'jean@specialized247.com',
                'phillip@specialized247.com'
            ],
            other: [
                'axcel@specialized247.com',
                'karla@specialized247.com'
            ]
         },
        users: [
            'axcel@specialized247.com',
            'catherine@specialized247.com',
            'ecampos@specialized247.com',
            'glizardo@specialized247.com',
            'jean@specialized247.com',
            'karla@specialized247.com',
            'phillip@specialized247.com',
            'sergio@specialized247.com'
        ]
    },
    {
        team_name: 'Operations',
        manager: null,
        supervisors: [ ],
        subteams: { },
        users: [
            'alexia@specialized247.com',
            'mike@specialized247.com'
            ]
    },
    {
        team_name: 'Management',
        manager: null,
        supervisors: [],
        subteams: {},
        users: [
            'alejandro@specialized247.com',
            'jeremy@specialized247.com',
            'kyle@specialized247.com',
            'lilly@specialized247.com',
            'jennifer@specialized247.com'
        ]
    }
];

const userRoleOverrides = {
    'dorian@specialized247.com': {
        primary_team: 'Leasing',
        secondary_teams: ['Field Assessors'],
        notes: 'Mostly leasing agent; also performs some field assessor work.'
    },
    'jeremy@specialized247.com': {
        leadership_role: 'Manager',
        primary_team: 'Field Assessors',
        secondary_teams: [
            'Leasing'
        ],
        notes: 'Player-coach. Manages Field Assessors while actively performing field assessor and leasing work.'
    },
    'jennifer@specialized247.com': {
        leadership_role: 'Department Head',
        primary_team: 'Asset Management',
        secondary_teams: ['Management'],
        notes: 'Included in Management dashboard grouping but does not report to Dustin.'
    },
    'kyle@specialized247.com': {
        leadership_role: 'Department Head',
        primary_team: 'Concierge',
        secondary_teams: ['Management'],
        notes: 'Included in Management dashboard grouping. Operational owner of Concierge. Reports to Jennifer Potter.'
    }
};

module.exports = {
    teamMappings,
    userRoleOverrides
};